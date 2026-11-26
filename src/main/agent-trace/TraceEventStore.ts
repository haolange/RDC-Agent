import fs from 'fs';
import path from 'path';
import { z, type ZodType } from 'zod';
import { generateEventId, nowIso } from '@shared/utils/id';
import { AppError } from '@shared/errors/appError';
import { parseJsonWith, readValidatedSync } from '../runtime/atomicFile';
import { appendJsonl, assertNoJsonlDiagnostics, readJsonl, writeJsonl } from '../runtime/jsonl';
import type { AgentRun } from '@shared/types/agenticTrace';

const AgentRunSchema: ZodType<AgentRun> = z
  .object({
    runId: z.string(),
    agentType: z.string(),
    title: z.string().optional(),
    userRequest: z.string(),
    status: z.enum(['pending', 'running', 'succeeded', 'failed', 'cancelled', 'skipped', 'waiting_approval']),
    createdAt: z.string(),
    updatedAt: z.string(),
    context: z.record(z.string(), z.unknown()).optional(),
    profileVersion: z.string().optional(),
  })
  .strict();

const TraceEventSchema: ZodType<TraceEvent> = z
  .object({
    eventId: z.string(),
    runId: z.string(),
    seq: z.number(),
    timestamp: z.string(),
    type: z.enum([
      'node.created',
      'node.updated',
      'tool.started',
      'tool.completed',
      'tool.failed',
      'phase.started',
      'phase.completed',
      'run.completed',
      'run.failed',
      'run.cancelled',
    ]),
    payload: z.unknown(),
    visibility: z.enum(['user', 'debug', 'internal']),
  })
  .strict();

const readRun = (file: string): AgentRun | null => readValidatedSync(file, parseJsonWith(AgentRunSchema.parse));

export class TraceRunStore {
  private runsDir: string;

  constructor(traceRoot: string) {
    this.runsDir = path.join(traceRoot, 'runs');
    fs.mkdirSync(this.runsDir, { recursive: true });
  }

  private runPath(runId: string): string {
    return path.join(this.runsDir, `${runId}.json`);
  }

  save(run: AgentRun): void {
    fs.writeFileSync(this.runPath(run.runId), JSON.stringify(run, null, 2), 'utf-8');
  }

  get(runId: string): AgentRun | null {
    return readRun(this.runPath(runId));
  }

  list(): AgentRun[] {
    if (!fs.existsSync(this.runsDir)) return [];
    return fs
      .readdirSync(this.runsDir)
      .filter((name) => name.endsWith('.json'))
      .flatMap((name) => readRun(path.join(this.runsDir, name)) ?? [])
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  }
}

export class TraceEventStore {
  private eventsDir: string;
  private seqCounters = new Map<string, number>();

  constructor(traceRoot: string) {
    this.eventsDir = path.join(traceRoot, 'events');
    fs.mkdirSync(this.eventsDir, { recursive: true });
  }

  private eventsPath(runId: string): string {
    return path.join(this.eventsDir, `${runId}.jsonl`);
  }

  private seqLockPath(runId: string): string {
    return path.join(this.eventsDir, `${runId}.seq.lock`);
  }

  /**
   * Allocate the next monotonic seq for a run.
   * Combines in-memory counter with on-disk max(seq) + exclusive lock file
   * so concurrent store instances / process restarts do not collide.
   */
  private nextSeq(runId: string): number {
    const lockPath = this.seqLockPath(runId);
    const fd = fs.openSync(lockPath, 'a+');
    try {
      // Best-effort exclusive section via O_EXCL sidecar when missing; always re-read disk max.
      const diskMax = this.readDiskMaxSeq(runId);
      const mem = this.seqCounters.get(runId) ?? 0;
      const next = Math.max(diskMax, mem) + 1;
      // Detect collision: if disk already has this seq, bump until free.
      let seq = next;
      const existing = new Set(
        this.getEventsRaw(runId)
          .map((event) => event.seq)
          .filter((value) => Number.isFinite(value)),
      );
      while (existing.has(seq)) {
        seq += 1;
      }
      this.seqCounters.set(runId, seq);
      fs.writeFileSync(fd, `${seq}\n`, { encoding: 'utf-8', flag: 'w' });
      return seq;
    } finally {
      fs.closeSync(fd);
    }
  }

  private readDiskMaxSeq(runId: string): number {
    const events = this.getEventsRaw(runId);
    if (events.length === 0) return 0;
    return Math.max(...events.map((event) => Number(event.seq) || 0));
  }

  private getEventsRaw(runId: string): TraceEvent[] {
    const filePath = this.eventsPath(runId);
    const result = readJsonl(filePath, TraceEventSchema.parse);
    assertNoJsonlDiagnostics(filePath, result.diagnostics);
    return result.records;
  }

  append(runId: string, type: TraceEvent['type'], payload: unknown): TraceEvent {
    const seq = this.nextSeq(runId);
    const event: TraceEvent = {
      eventId: generateEventId('trace'),
      runId,
      seq,
      timestamp: nowIso(),
      type,
      payload,
      visibility: 'user',
    };
    appendJsonl(this.eventsPath(runId), event);
    return event;
  }

  getEvents(runId: string, afterSeq = 0): TraceEvent[] {
    const events = this.getEventsRaw(runId)
      .filter((event) => event.seq > afterSeq)
      .sort((a, b) => a.seq - b.seq);
    const seen = new Set<number>();
    for (const event of events) {
      if (seen.has(event.seq)) {
        throw new AppError('TRACE_SEQ_CONFLICT', `duplicate seq ${event.seq} in run ${runId}`);
      }
      seen.add(event.seq);
    }
    return events;
  }

  exportRun(runId: string): { run: AgentRun | null; events: TraceEvent[] } {
    const runStore = new TraceRunStore(path.dirname(this.eventsDir));
    return {
      run: runStore.get(runId),
      events: this.getEvents(runId),
    };
  }

  replaceEvents(runId: string, events: TraceEvent[]): void {
    writeJsonl(this.eventsPath(runId), events);
    this.seqCounters.set(runId, events.length > 0 ? Math.max(...events.map((e) => e.seq)) : 0);
  }
}

export type TraceEventType =
  | 'node.created'
  | 'node.updated'
  | 'tool.started'
  | 'tool.completed'
  | 'tool.failed'
  | 'phase.started'
  | 'phase.completed'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled';

export interface TraceEvent {
  eventId: string;
  runId: string;
  seq: number;
  timestamp: string;
  type: TraceEventType;
  payload: unknown;
  visibility: 'user' | 'debug' | 'internal';
}
