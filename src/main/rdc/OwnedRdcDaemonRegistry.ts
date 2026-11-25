import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '@shared/errors/appError';
import { appPathService } from '../runtime/AppPathService';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { settingsService } from '../settings/settings-core/SettingsService';
import {
  probeProcess,
  readProcessCommandLine,
  terminateProcessTree,
  type ProcessIdentity,
  type ProcessLiveness,
  type ProcessTermination,
} from '../platform/process';
import { installationRootOfPython, resolveRdcInstallation } from './RdcInstallationService';
import { parseRdcNativeResult } from './RdcNativeProtocol';
import { rdcCliInvokerService } from './RdcCliInvokerService';
import { RDC_INTERMEDIATE_ROOT_ENV, withRdcHostRuntimeEnv } from './withRdcHostRuntimeEnv';
import type { RdcCliInvokerSettings } from '@shared/types/settings';

export const APP_RDC_CONTEXT_ID = /^rdc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGISTRY_SCHEMA = 1;
const REGISTRY_FILE = 'owned-rdc-daemons.json';

/** Births are the RDC-Tool daemon state tokens; an empty birth was not recorded. */
export interface OwnedRdcDaemonRecord {
  contextId: string;
  command: string;
  intermediateRoot: string;
  ownerPid: number;
  ownerBirth: string;
  daemonPid: number;
  daemonBirth: string;
  workerPid: number;
  workerBirth: string;
  startedAt: number;
}

export interface OwnedRdcDaemonHarvestFailure {
  contextId: string;
  error: string;
}

export interface OwnedRdcDaemonHarvestResult {
  released: string[];
  failed: OwnedRdcDaemonHarvestFailure[];
  /** Daemon state on disk with no ownership record. No receipt proves it is ours, so it is left running. */
  unconfirmed: string[];
}

export interface OwnedRdcDaemonStoreOptions {
  registryPath?: string;
  intermediateRoot?: string;
}

interface RegistryDocument {
  schemaVersion: number;
  records: Record<string, OwnedRdcDaemonRecord>;
}

export function isAppRdcContextId(contextId: string): boolean {
  return APP_RDC_CONTEXT_ID.test(contextId.trim());
}

export function ownedRdcDaemonRegistryPath(appStateRoot?: string): string {
  return path.join(appStateRoot ?? appPathService.getAppStatePaths().appStateRoot, REGISTRY_FILE);
}

export function listAppDaemonContextsInIntermediateRoot(intermediateRoot: string): string[] {
  const directory = path.join(intermediateRoot, 'runtime', 'rdc_tool_cli');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .flatMap((name) => {
      const match = /^daemon_state_(rdc-.+)\.json$/i.exec(name);
      return match && isAppRdcContextId(match[1]) ? [match[1]] : [];
    })
    .sort();
}

export function rememberOwnedRdcDaemon(record: OwnedRdcDaemonRecord, options: OwnedRdcDaemonStoreOptions = {}): void {
  if (!isAppRdcContextId(record.contextId)) {
    throw new AppError('RDC_OWNERSHIP_DENIED', `${record.contextId} is not an application-owned daemon context.`);
  }
  const document = readRegistry(options.registryPath);
  document.records[record.contextId] = { ...record, contextId: record.contextId };
  writeRegistry(document, options.registryPath);
}

export function forgetOwnedRdcDaemon(contextId: string, options: OwnedRdcDaemonStoreOptions = {}): void {
  const document = readRegistry(options.registryPath);
  if (!document.records[contextId]) return;
  delete document.records[contextId];
  writeRegistry(document, options.registryPath);
}

export function listOwnedRdcDaemons(options: OwnedRdcDaemonStoreOptions = {}): OwnedRdcDaemonRecord[] {
  return Object.values(readRegistry(options.registryPath).records);
}

type OwnedRdcDaemonHarvestOptions = OwnedRdcDaemonStoreOptions & {
  execute?: typeof rdcCliInvokerService.executeCLI;
  settings?: RdcCliInvokerSettings;
  signal?: AbortSignal;
  probeProcess?: (identity: ProcessIdentity) => ProcessLiveness;
  readCommandLine?: (pid: number) => string | null;
  terminateProcess?: (identity: ProcessIdentity) => ProcessTermination;
};

const ownerIdentity = (record: OwnedRdcDaemonRecord): ProcessIdentity => ({ pid: record.ownerPid, birth: record.ownerBirth });
const daemonIdentity = (record: OwnedRdcDaemonRecord): ProcessIdentity => ({ pid: record.daemonPid, birth: record.daemonBirth });
const workerIdentity = (record: OwnedRdcDaemonRecord): ProcessIdentity => ({ pid: record.workerPid, birth: record.workerBirth });

export async function harvestOwnedRdcDaemons(
  options: OwnedRdcDaemonHarvestOptions = {},
): Promise<OwnedRdcDaemonHarvestResult> {
  const intermediateRoot = options.intermediateRoot ?? hostIntermediateRoot(options.settings);
  const discovered = listAppDaemonContextsInIntermediateRoot(intermediateRoot);
  let records: Map<string, OwnedRdcDaemonRecord>;
  try {
    records = new Map(listOwnedRdcDaemons(options).map((record) => [record.contextId, record]));
  } catch (error) {
    // Without a readable registry no daemon is provably ours: stop nothing and report, so the caller can carry on.
    const message = error instanceof Error ? error.message : String(error);
    logHarvest('error', 'RDC daemon ownership registry unreadable', message, { error: message, discovered });
    return { released: [], failed: [{ contextId: REGISTRY_FILE, error: message }], unconfirmed: discovered };
  }
  // Another instance (for example a Browser QA run with its own userData) may own these; they are not stopped.
  const unconfirmed = discovered.filter((contextId) => !records.has(contextId));
  if (unconfirmed.length) {
    logHarvest('warning', 'RDC daemon state without an ownership record left running', unconfirmed.join(', '), { unconfirmed });
  }

  const released: string[] = [];
  const failed: OwnedRdcDaemonHarvestFailure[] = [];
  for (const record of records.values()) {
    if (!isAppRdcContextId(record.contextId)) continue;
    try {
      options.signal?.throwIfAborted();
      const probe = options.probeProcess ?? probeProcess;
      const owner = probe(ownerIdentity(record));
      if (record.ownerPid !== process.pid && owner !== 'exited') {
        throw new AppError('RDC_OWNERSHIP_BUSY', `owner ${record.ownerPid} is ${owner === 'alive' ? 'still alive' : 'unverifiable'}.`);
      }
      const stateFile = path.join(record.intermediateRoot, 'runtime', 'rdc_tool_cli', `daemon_state_${record.contextId}.json`);
      const dead = owner === 'exited' && [daemonIdentity(record), workerIdentity(record)].every((identity) => probe(identity) === 'exited');
      // A dead owner, no native processes and no endpoint state need no CLI mutation.
      if (!dead || fs.existsSync(stateFile)) await stopOwnedDaemon(record, options);
      forgetOwnedRdcDaemon(record.contextId, options);
      released.push(record.contextId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ contextId: record.contextId, error: message });
      logHarvest('error', 'RDC daemon harvest failed', `${record.contextId}: ${message}`, { contextId: record.contextId, error: message });
    }
  }
  return { released, failed, unconfirmed };
}

function logHarvest(severity: 'error' | 'warning', title: string, summary: string, raw: Record<string, unknown>): void {
  runtimeLogService.log({ scope: 'app', namespace: 'context', severity, title, summary, raw });
}

async function stopOwnedDaemon(
  record: OwnedRdcDaemonRecord,
  options: OwnedRdcDaemonHarvestOptions,
): Promise<void> {
  const current = withRdcHostRuntimeEnv(options.settings ?? settingsService.getAll().tooling.rdcCli);
  const command = record.command.trim() || current.command.trim();
  const commandMissing = Boolean(command) && (path.isAbsolute(command) || command.includes(path.sep)) && !fs.existsSync(command);
  if (!command || commandMissing) {
    killVerifiedOwnedPids(record, options);
    return;
  }
  const binding = path.isAbsolute(command)
    ? resolveRdcInstallation({ root: installationRootOfPython(command), timeoutMs: current.timeoutMs, env: current.env })
    : current;
  const settings = withRdcHostRuntimeEnv({
    ...binding,
    enabled: true,
    command,
    env: { ...current.env, [RDC_INTERMEDIATE_ROOT_ENV]: record.intermediateRoot || current.env[RDC_INTERMEDIATE_ROOT_ENV] },
  });
  const execute = options.execute ?? ((...args: Parameters<typeof rdcCliInvokerService.executeCLI>) => rdcCliInvokerService.executeCLI(...args));
  const invoke = async (cliCommand: string, args: string[], kind: string) => parseRdcNativeResult(
    await execute(cliCommand, args, {
      contextId: record.contextId,
      abortSignal: options.signal,
      settings: settings,
    }),
    record.contextId,
    kind,
  );
  const cleared = await invoke('context', ['clear', '--daemon-context', record.contextId], 'rdc_tool.context.clear').catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (/no active daemon/i.test(message)) return null;
    throw error;
  });
  if (cleared && cleared.data.context_id && cleared.data.context_id !== record.contextId) {
    throw new AppError('RDC_CONTEXT_MISMATCH', 'context clear does not belong to the owned daemon.');
  }
  try {
    const stopped = await invoke('daemon', ['stop', '--daemon-context', record.contextId], 'rdc_tool.daemon.stop');
    if (stopped.data.stopped !== true) throw new AppError('RDC_CLOSE_FAILED', 'daemon shutdown was not confirmed.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no active daemon/i.test(message)) throw error;
    killVerifiedOwnedPids(record, options);
  }
}

function killVerifiedOwnedPids(
  record: OwnedRdcDaemonRecord,
  options: OwnedRdcDaemonHarvestOptions,
): void {
  const probe = options.probeProcess ?? probeProcess;
  const readCommandLine = options.readCommandLine ?? readProcessCommandLine;
  const terminate = options.terminateProcess ?? terminateProcessTree;
  const remaining: number[] = [];
  for (const [identity, expected] of [
    [daemonIdentity(record), 'rdc_tool.daemon.server'],
    [workerIdentity(record), 'rdc_tool.runtime.worker_main'],
  ] as const) {
    const liveness = probe(identity);
    if (liveness === 'exited') continue;
    // An unreadable identity or command line is never proof of exit and never authorizes a kill.
    const commandLine = liveness === 'alive' ? readCommandLine(identity.pid) : null;
    if (!commandLine?.includes(expected) || !commandLine.includes(record.contextId)) {
      throw new AppError('RDC_CLOSE_FAILED', `pid ${identity.pid} is not a confirmed ${expected} for ${record.contextId}.`);
    }
    if (terminate(identity) === 'unconfirmed') remaining.push(identity.pid);
  }
  if (remaining.length) throw new AppError('RDC_CLOSE_FAILED', `owned pids still running: ${remaining.join(', ')}`);
}

function hostIntermediateRoot(settings?: RdcCliInvokerSettings): string {
  return withRdcHostRuntimeEnv(settings ?? settingsService.getAll().tooling.rdcCli).env[RDC_INTERMEDIATE_ROOT_ENV] ?? '';
}

function readRegistry(registryPath?: string): RegistryDocument {
  const filePath = registryPath ?? ownedRdcDaemonRegistryPath();
  if (!fs.existsSync(filePath)) return { schemaVersion: REGISTRY_SCHEMA, records: {} };
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8')) as RegistryDocument;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AppError('RDC_OWNERSHIP_CORRUPT', 'owned daemon registry is not an object.');
  }
  if (payload.schemaVersion !== REGISTRY_SCHEMA) {
    throw new AppError('STORAGE_SCHEMA_UNSUPPORTED', `owned-rdc-daemons schema ${String(payload.schemaVersion)}`);
  }
  const records: Record<string, OwnedRdcDaemonRecord> = {};
  const birth = (value: unknown): string => (typeof value === 'string' ? value : '');
  for (const [contextId, record] of Object.entries(payload.records ?? {})) {
    if (!record || !isAppRdcContextId(contextId) || record.contextId !== contextId) continue;
    records[contextId] = {
      ...record,
      ownerBirth: birth(record.ownerBirth),
      daemonBirth: birth(record.daemonBirth),
      workerBirth: birth(record.workerBirth),
    };
  }
  return { schemaVersion: REGISTRY_SCHEMA, records };
}

function writeRegistry(document: RegistryDocument, registryPath?: string): void {
  const filePath = registryPath ?? ownedRdcDaemonRegistryPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}
