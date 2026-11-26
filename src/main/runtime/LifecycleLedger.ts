import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { SHUTDOWN_CAUSES, TURN_STOP_CAUSES } from '@shared/types/lifecycle';
import { SHUTDOWN_PHASE_ORDER } from '../lifecycle/ShutdownCoordinator';
import { renameWithRetrySync, syncDirectorySync } from '../platform/fileRename';
import { appPathService } from './AppPathService';
import { appendJsonlDurable, readJsonl } from './jsonl';
import { redactCredentialLikeText, redactSecretsDeep } from './secretRedaction';
import type { ProcessExitReason, ProcessOwner } from './ProcessSupervisor';

const LEDGER_FILE = 'ledger.jsonl';
/** The one rotated generation: the file the current one replaced when it reached the cap. */
const PREVIOUS_GENERATION_FILE = 'ledger.previous.jsonl';
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const MAX_MESSAGE_CHARS = 500;
const MAX_STACK_CHARS = 4096;

const PROCESS_OWNERS = {
  mcp: true,
  shell: true,
  hook: true,
  replay: true,
  'agent-shell': true,
  background: true,
  other: true,
} satisfies Record<ProcessOwner, true>;
const PROCESS_EXIT_REASONS = {
  exit: true,
  signal: true,
  timeout: true,
  abort: true,
  spawn_failed: true,
  supervisor_kill: true,
  unconfirmed_orphan: true,
} satisfies Record<ProcessExitReason, true>;
const keysOf = <K extends string>(record: Record<K, true>) => Object.keys(record) as [K, ...K[]];

/** Chromium child processes by role; `renderer` comes from a web contents, the others from `child-process-gone`. */
export const GONE_PROCESS_KINDS = [
  'renderer',
  'gpu',
  'utility',
  'zygote',
  'sandbox-helper',
  'pepper-plugin',
  'pepper-plugin-broker',
  'unknown',
] as const;
export type GoneProcessKind = (typeof GONE_PROCESS_KINDS)[number];

const id = z.string().min(1);
const header = { at: z.iso.datetime(), instanceId: id };

/**
 * One ledger line per lifecycle fact. The ledger records facts about processes, shutdown and turns, never what a person
 * or a model wrote: no prompts, tool arguments, file contents or secrets. Free text (a fault message or stack) is
 * credential-redacted and has the user's home and data directory replaced before it is written.
 */
export const LifecycleRecordSchema = z.union([
  z.strictObject({
    ...header,
    kind: z.literal('instance_started'),
    pid: z.number().int(),
    birth: z.string(),
    appVersion: z.string(),
    electronVersion: z.string(),
    mode: z.enum(['desktop', 'browser']),
  }),
  z.strictObject({ ...header, kind: z.literal('instance_exited'), clean: z.boolean(), exitCode: z.number().int() }),
  z.strictObject({ ...header, kind: z.literal('shutdown_began'), cause: z.enum(SHUTDOWN_CAUSES) }),
  z.strictObject({
    ...header,
    kind: z.literal('shutdown_phase_timed_out'),
    phase: z.enum(SHUTDOWN_PHASE_ORDER),
    pending: z.array(id),
  }),
  z.strictObject({
    ...header,
    kind: z.literal('shutdown_finished'),
    timedOut: z.boolean(),
    durationMs: z.number().nonnegative(),
  }),
  z.strictObject({
    ...header,
    kind: z.literal('process_gone'),
    process: z.enum(GONE_PROCESS_KINDS),
    reason: id,
    exitCode: z.number().int(),
    serviceName: z.string().optional(),
  }),
  z.strictObject({
    ...header,
    kind: z.literal('worker_thread_exited'),
    worker: z.enum(['turn-preparation', 'grep-regex']),
    reason: z.enum(['error', 'exit']),
    exitCode: z.number().int().optional(),
    message: z.string().optional(),
  }),
  z.strictObject({
    ...header,
    kind: z.literal('supervised_child_exited'),
    owner: z.enum(keysOf(PROCESS_OWNERS)),
    reason: z.enum(keysOf(PROCESS_EXIT_REASONS)),
    code: z.number().int().nullable(),
    signal: z.string().nullable(),
  }),
  z.strictObject({
    ...header,
    kind: z.literal('fault'),
    fault: z.enum(['uncaughtException', 'unhandledRejection']),
    message: z.string(),
    stack: z.string().optional(),
    stackHash: z.string().regex(/^[0-9a-f]{16}$/),
  }),
  z.strictObject({
    ...header,
    kind: z.literal('turn_started'),
    sessionId: id.nullable(),
    turnId: id,
    runId: id.nullable(),
    providerId: id,
    modelId: id,
  }),
  z.strictObject({
    ...header,
    kind: z.literal('turn_finished'),
    sessionId: id.nullable(),
    turnId: id,
    status: z.enum(['complete', 'stopped', 'error']),
    stopCause: z.enum(TURN_STOP_CAUSES).optional(),
  }),
  z.strictObject({
    ...header,
    kind: z.literal('rdc_operation'),
    phase: z.literal('started'),
    sessionId: id,
    operation: id,
    requestId: id,
  }),
  z.strictObject({
    ...header,
    kind: z.literal('rdc_operation'),
    phase: z.literal('terminal'),
    sessionId: id,
    operation: id,
    requestId: id,
    outcome: z.enum(['completed', 'failed', 'stuck', 'cancelled', 'worker-lost']),
    errorCode: z.string().optional(),
    workerExit: z.strictObject({ pid: z.number().int().optional(), reason: id, confirmed: z.boolean() }).optional(),
  }),
  z.strictObject({
    ...header,
    kind: z.literal('recovery_step'),
    sessionId: id,
    step: id,
    decision: z.enum(['keep', 'rebuild', 'quarantined']),
    reason: z.string().optional(),
    errorCode: z.string().optional(),
  }),
  z.strictObject({
    ...header,
    kind: z.literal('continuation_decision'),
    sessionId: id.nullable(),
    turnId: id,
    dropped: z.number().int().nonnegative(),
    reasons: z.array(z.strictObject({ reason: id, count: z.number().int().nonnegative() })),
  }),
]);

export type LifecycleRecord = z.infer<typeof LifecycleRecordSchema>;
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** A record as a producer states it; the ledger adds the time and this launch's instance id. */
export type LifecycleEvent = DistributiveOmit<LifecycleRecord, 'at' | 'instanceId'>;

export interface LifecycleTail {
  records: LifecycleRecord[];
  /** Complete lines that are not valid records (damage, or a file written in another format). */
  damaged: number;
}

export interface LifecycleLedgerOptions {
  instanceId: string;
  directory: () => string;
  maxBytes?: number;
  /** Absolute directories replaced in free text by a placeholder (the data directory, the home directory). */
  pathPrefixes?: () => ReadonlyArray<readonly [string, string]>;
  now?: () => number;
}

/**
 * The durable lifecycle record of every launch under `<appStateRoot>/lifecycle/ledger.jsonl`: instance start and exit,
 * shutdown, process faults and child-process deaths, turns. Each record is fsynced before `record` returns, so it is
 * there to read at the next launch whatever ends this one. The file is capped; at the cap it becomes the one previous
 * generation and a new file starts. Recording never throws: a fact that cannot be written is reported on stderr and
 * the producer goes on.
 */
export class LifecycleLedger {
  readonly instanceId: string;

  constructor(private readonly options: LifecycleLedgerOptions) {
    this.instanceId = options.instanceId;
  }

  get filePath(): string {
    return path.join(this.options.directory(), LEDGER_FILE);
  }

  private get previousGenerationPath(): string {
    return path.join(this.options.directory(), PREVIOUS_GENERATION_FILE);
  }

  record(event: LifecycleEvent): boolean {
    try {
      const now = this.options.now?.() ?? Date.now();
      const scrubbed = redactSecretsDeep(this.scrubPaths(event)).value as LifecycleEvent;
      const record = LifecycleRecordSchema.parse({
        ...scrubbed,
        at: new Date(now).toISOString(),
        instanceId: this.instanceId,
      });
      this.rotateIfFull(Buffer.byteLength(`${JSON.stringify(record)}\n`));
      appendJsonlDurable(this.filePath, record);
      return true;
    } catch (error) {
      console.error('[lifecycle-ledger] record not written:', error instanceof Error ? error.message : String(error));
      return false;
    }
  }

  /** An uncaught fault: its message and stack, bounded, scrubbed and fingerprinted by the scrubbed stack. */
  recordFault(fault: 'uncaughtException' | 'unhandledRejection', error: unknown): boolean {
    const message = this.scrubText(error instanceof Error ? error.message : String(error)).slice(0, MAX_MESSAGE_CHARS);
    const stack = error instanceof Error && error.stack ? this.scrubText(error.stack).slice(0, MAX_STACK_CHARS) : '';
    const stackHash = createHash('sha256')
      .update(stack || message)
      .digest('hex')
      .slice(0, 16);
    return this.record({ kind: 'fault', fault, message, ...(stack ? { stack } : {}), stackHash });
  }

  /**
   * The records of both generations, oldest first, optionally of one instance. An interrupted final append is not a
   * record and is skipped; other lines that are not valid records are counted as damaged.
   */
  tail(instanceId?: string): LifecycleTail {
    const select = instanceId ? (record: LifecycleRecord) => record.instanceId === instanceId : undefined;
    const tail: LifecycleTail = { records: [], damaged: 0 };
    for (const file of [this.previousGenerationPath, this.filePath]) {
      const read = readJsonl(file, (value) => LifecycleRecordSchema.parse(value), select);
      tail.records.push(...read.records);
      tail.damaged += read.diagnostics.length;
    }
    return tail;
  }

  /** Replaces the user's directories in free text, so a stack names no account or machine path. */
  scrubText(text: string): string {
    let scrubbed = redactCredentialLikeText(text);
    const prefixes = [...(this.options.pathPrefixes?.() ?? [])].sort(([a], [b]) => b.length - a.length);
    for (const [prefix, placeholder] of prefixes) {
      if (!prefix) continue;
      for (const spelling of new Set([prefix, prefix.replace(/\\/g, '/')])) {
        scrubbed = scrubbed.split(spelling).join(placeholder);
      }
    }
    return scrubbed;
  }

  private scrubPaths(event: LifecycleEvent): LifecycleEvent {
    return Object.fromEntries(
      Object.entries(event).map(([key, value]) => [key, typeof value === 'string' ? this.scrubText(value) : value]),
    ) as LifecycleEvent;
  }

  private rotateIfFull(appendBytes: number): void {
    const current = this.filePath;
    let size: number;
    try {
      size = fs.statSync(current).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (size + appendBytes <= (this.options.maxBytes ?? DEFAULT_MAX_BYTES)) return;
    renameWithRetrySync(current, this.previousGenerationPath);
    syncDirectorySync(path.dirname(current));
  }
}

/** This launch's ledger; its instance id also stamps the Task executions this launch starts. */
export const lifecycleLedger = new LifecycleLedger({
  instanceId: randomUUID(),
  directory: () => path.join(appPathService.getAppStatePaths().appStateRoot, 'lifecycle'),
  pathPrefixes: () => [
    [path.dirname(appPathService.getAppStatePaths().appStateRoot), '<userData>'],
    [os.homedir(), '~'],
  ],
});
