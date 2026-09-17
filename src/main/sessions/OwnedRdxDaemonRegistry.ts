import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { RdxCliInvokerSettings } from '@shared/types/settings';
import { appPathService } from '../runtime/AppPathService';
import { runtimeLogService } from '../runtime/RuntimeLogService';
import { parseRdxNativeResult } from '../tools/RdxNativeProtocol';
import { rdxCliInvokerService } from '../tools/RdxCliInvokerService';
import { RDX_INTERMEDIATE_ROOT_ENV, withRdxHostRuntimeEnv } from '../tools/withRdxHostRuntimeEnv';
import { settingsService } from '../settings/SettingsService';

export const APP_RDX_CONTEXT_ID = /^rdc-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REGISTRY_SCHEMA = 1;
const REGISTRY_FILE = 'owned-rdx-daemons.json';

export interface OwnedRdxDaemonRecord {
  contextId: string;
  command: string;
  intermediateRoot: string;
  ownerPid: number;
  daemonPid: number;
  workerPid: number;
  startedAt: number;
}

export interface OwnedRdxDaemonHarvestFailure {
  contextId: string;
  error: string;
}

export interface OwnedRdxDaemonHarvestResult {
  released: string[];
  failed: OwnedRdxDaemonHarvestFailure[];
}

export interface OwnedRdxDaemonStoreOptions {
  registryPath?: string;
  intermediateRoot?: string;
}

interface RegistryDocument {
  schemaVersion: number;
  records: Record<string, OwnedRdxDaemonRecord>;
}

export function isAppRdxContextId(contextId: string): boolean {
  return APP_RDX_CONTEXT_ID.test(contextId.trim());
}

export function ownedRdxDaemonRegistryPath(appStateRoot?: string): string {
  return path.join(appStateRoot ?? appPathService.getAppStatePaths().appStateRoot, REGISTRY_FILE);
}

export function listAppDaemonContextsInIntermediateRoot(intermediateRoot: string): string[] {
  const directory = path.join(intermediateRoot, 'runtime', 'rdx_cli');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .flatMap((name) => {
      const match = /^daemon_state_(rdc-.+)\.json$/i.exec(name);
      return match && isAppRdxContextId(match[1]) ? [match[1]] : [];
    })
    .sort();
}

export function rememberOwnedRdxDaemon(record: OwnedRdxDaemonRecord, options: OwnedRdxDaemonStoreOptions = {}): void {
  if (!isAppRdxContextId(record.contextId)) {
    throw new Error(`RDX_OWNERSHIP_DENIED: ${record.contextId} is not an application-owned daemon context.`);
  }
  const document = readRegistry(options.registryPath);
  document.records[record.contextId] = { ...record, contextId: record.contextId };
  writeRegistry(document, options.registryPath);
}

export function forgetOwnedRdxDaemon(contextId: string, options: OwnedRdxDaemonStoreOptions = {}): void {
  const document = readRegistry(options.registryPath);
  if (!document.records[contextId]) return;
  delete document.records[contextId];
  writeRegistry(document, options.registryPath);
}

export function listOwnedRdxDaemons(options: OwnedRdxDaemonStoreOptions = {}): OwnedRdxDaemonRecord[] {
  return Object.values(readRegistry(options.registryPath).records);
}

type OwnedRdxDaemonHarvestOptions = OwnedRdxDaemonStoreOptions & {
  execute?: typeof rdxCliInvokerService.executeCLI;
  settings?: RdxCliInvokerSettings;
  signal?: AbortSignal;
  readCommandLine?: (pid: number) => string;
  killPid?: (pid: number) => boolean;
};

export async function harvestOwnedRdxDaemons(
  options: OwnedRdxDaemonHarvestOptions = {},
): Promise<OwnedRdxDaemonHarvestResult> {
  const intermediateRoot = options.intermediateRoot ?? hostIntermediateRoot(options.settings);
  const discovered = listAppDaemonContextsInIntermediateRoot(intermediateRoot);
  const records = new Map(listOwnedRdxDaemons(options).map((record) => [record.contextId, record]));
  for (const contextId of discovered) {
    if (!records.has(contextId)) {
      records.set(contextId, {
        contextId,
        command: options.settings?.command ?? settingsService.getAll().tooling.rdxCli.command,
        intermediateRoot,
        ownerPid: process.pid,
        daemonPid: 0,
        workerPid: 0,
        startedAt: 0,
      });
    }
  }

  const released: string[] = [];
  const failed: OwnedRdxDaemonHarvestFailure[] = [];
  for (const record of records.values()) {
    if (!isAppRdxContextId(record.contextId)) continue;
    try {
      options.signal?.throwIfAborted();
      await stopOwnedDaemon(record, options);
      forgetOwnedRdxDaemon(record.contextId, options);
      released.push(record.contextId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ contextId: record.contextId, error: message });
      runtimeLogService.log({
        scope: 'app',
        namespace: 'context',
        severity: 'error',
        title: 'RDX daemon harvest failed',
        summary: `${record.contextId}: ${message}`,
        raw: { contextId: record.contextId, error: message },
      });
    }
  }
  return { released, failed };
}

async function stopOwnedDaemon(
  record: OwnedRdxDaemonRecord,
  options: OwnedRdxDaemonHarvestOptions,
): Promise<void> {
  const current = withRdxHostRuntimeEnv(options.settings ?? settingsService.getAll().tooling.rdxCli);
  const command = record.command.trim() || current.command.trim();
  const commandMissing = Boolean(command) && (path.isAbsolute(command) || command.includes(path.sep)) && !fs.existsSync(command);
  if (!command || commandMissing) {
    killVerifiedOwnedPids(record, options);
    return;
  }
  const settings = withRdxHostRuntimeEnv({
    ...current,
    enabled: true,
    command,
    env: { ...current.env, [RDX_INTERMEDIATE_ROOT_ENV]: record.intermediateRoot || current.env[RDX_INTERMEDIATE_ROOT_ENV] },
  });
  const execute = options.execute ?? ((...args: Parameters<typeof rdxCliInvokerService.executeCLI>) => rdxCliInvokerService.executeCLI(...args));
  const invoke = async (cliCommand: string, args: string[], kind: string) => parseRdxNativeResult(
    await execute(cliCommand, args, {
      contextId: record.contextId,
      abortSignal: options.signal,
      settings: { ...settings, argsPrefix: [...settings.argsPrefix.filter((arg) => arg !== '--json'), '--json'] },
    }),
    record.contextId,
    kind,
  );
  const cleared = await invoke('context', ['clear', '--daemon-context', record.contextId], 'rdx.context.clear').catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (/no active daemon/i.test(message)) return null;
    throw error;
  });
  if (cleared && cleared.data.context_id && cleared.data.context_id !== record.contextId) {
    throw new Error('RDX_CONTEXT_MISMATCH: context clear does not belong to the owned daemon.');
  }
  try {
    const stopped = await invoke('daemon', ['stop', '--daemon-context', record.contextId], 'rdx.daemon.stop');
    if (stopped.data.stopped !== true) throw new Error('RDX_CLOSE_FAILED: daemon shutdown was not confirmed.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/no active daemon/i.test(message)) throw error;
    killVerifiedOwnedPids(record, options);
  }
}

function killVerifiedOwnedPids(
  record: OwnedRdxDaemonRecord,
  options: OwnedRdxDaemonHarvestOptions,
): void {
  const readCommandLine = options.readCommandLine ?? readProcessCommandLine;
  const killPid = options.killPid ?? terminatePid;
  const remaining: number[] = [];
  for (const [pid, expected] of [
    [record.daemonPid, 'rdx.daemon.server'],
    [record.workerPid, 'rdx.runtime_worker'],
  ] as const) {
    if (pid <= 0) continue;
    const commandLine = readCommandLine(pid);
    if (!commandLine) continue;
    if (!commandLine.includes(expected) || !commandLine.includes(record.contextId)) {
      throw new Error(`RDX_CLOSE_FAILED: pid ${pid} is not a confirmed ${expected} for ${record.contextId}.`);
    }
    if (!killPid(pid)) remaining.push(pid);
  }
  if (remaining.length) throw new Error(`RDX_CLOSE_FAILED: owned pids still running: ${remaining.join(', ')}`);
}

function hostIntermediateRoot(settings?: RdxCliInvokerSettings): string {
  return withRdxHostRuntimeEnv(settings ?? settingsService.getAll().tooling.rdxCli).env[RDX_INTERMEDIATE_ROOT_ENV] ?? '';
}

function readRegistry(registryPath?: string): RegistryDocument {
  const filePath = registryPath ?? ownedRdxDaemonRegistryPath();
  if (!fs.existsSync(filePath)) return { schemaVersion: REGISTRY_SCHEMA, records: {} };
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8')) as RegistryDocument;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('RDX_OWNERSHIP_CORRUPT: owned daemon registry is not an object.');
  }
  if (payload.schemaVersion !== REGISTRY_SCHEMA) {
    throw new Error(`STORAGE_SCHEMA_UNSUPPORTED: owned-rdx-daemons schema ${String(payload.schemaVersion)}`);
  }
  const records: Record<string, OwnedRdxDaemonRecord> = {};
  for (const [contextId, record] of Object.entries(payload.records ?? {})) {
    if (!record || !isAppRdxContextId(contextId) || record.contextId !== contextId) continue;
    records[contextId] = record;
  }
  return { schemaVersion: REGISTRY_SCHEMA, records };
}

function writeRegistry(document: RegistryDocument, registryPath?: string): void {
  const filePath = registryPath ?? ownedRdxDaemonRegistryPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function readProcessCommandLine(pid: number): string {
  if (process.platform !== 'win32') {
    try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '); } catch { return ''; }
  }
  const result = spawnSync('powershell.exe', [
    '-NoProfile', '-Command',
    `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
  ], { windowsHide: true, encoding: 'utf8' });
  return (result.stdout ?? '').trim();
}

function terminatePid(pid: number): boolean {
  const result = process.platform === 'win32'
    ? spawnSync('taskkill', ['/PID', String(pid), '/F', '/T'], { windowsHide: true, stdio: 'ignore' })
    : spawnSync('kill', ['-9', String(pid)], { stdio: 'ignore' });
  return result.status === 0;
}
