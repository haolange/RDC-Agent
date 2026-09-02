import fs from 'fs';
import path from 'path';
import { parse as parseYamlDocument } from 'yaml';
import { stringifyYaml } from '@shared/utils/yaml';
import { nowIso } from '@shared/utils/id';
import type { CaptureDescriptor } from '@shared/types/session';
import { StorageSchemaError } from '../storageSchema';
import type { PersistedRunRecord } from '../storageTypes';
import type { StorageHost } from '../storageHost';
import { withDirectoryFileLockSync } from '../directoryFileLock';
import { archiveRunOriginalBytes, RUN_V3_MIGRATION_LOCK } from './runArchive';
import { recoverRunProfileId } from './runProfileRecovery';
import { PersistedRunRecordV3Schema, toPersistedRunV3 } from './runRecordSchema';

const CONVERSATION_SIDECARS = [
  'capture_refs.yaml',
  path.join('notes', 'hypothesis_board.yaml'),
];

const SNAKE_TO_CAMEL: Record<string, string> = {
  schema_version: 'schemaVersion',
  run_id: 'runId',
  turn_id: 'turnId',
  session_id: 'sessionId',
  case_id: 'caseId',
  project_id: 'projectId',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
  last_stage: 'lastStage',
  started_at: 'startedAt',
  finished_at: 'finishedAt',
  stopped_at: 'stoppedAt',
  stop_reason: 'stopReason',
  report_paths: 'reportPaths',
  profile_id: 'profileId',
};

function readSchemaVersion(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.schemaVersion === 'string') return record.schemaVersion;
  if (typeof record.schema_version === 'string') return record.schema_version;
  if (typeof record.schemaVersion === 'number') return String(record.schemaVersion);
  if (typeof record.schema_version === 'number') return String(record.schema_version);
  return null;
}

function assertSupportedRunVersion(raw: unknown, filePath: string): '0' | '1' | '2' | '3' | null {
  const version = readSchemaVersion(raw);
  if (version === null) return null;
  if (version === '0' || version === '1' || version === '2' || version === '3') return version;
  throw new StorageSchemaError(
    `STORAGE_SCHEMA_UNSUPPORTED: ${filePath} has schemaVersion ${version}; only 0, 1, 2, and 3 are supported`,
  );
}

function promoteTimestamp(value: unknown): unknown {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return value;
}

/** Promote snake_case aliases and coerce timestamps. Keeps historical leftovers for conflict/v3 checks. */
function promotePersistedRunKeys(raw: unknown): Record<string, unknown> {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {};
  for (const [snake, camel] of Object.entries(SNAKE_TO_CAMEL)) {
    if (record[camel] == null && record[snake] != null) {
      record[camel] = record[snake];
    }
    if (snake !== camel) delete record[snake];
  }
  for (const key of ['createdAt', 'updatedAt', 'startedAt', 'finishedAt', 'stoppedAt']) {
    if (!(key in record)) continue;
    record[key] = promoteTimestamp(record[key]);
  }
  if (typeof record.startedAt !== 'number' && typeof record.createdAt === 'number') {
    record.startedAt = record.createdAt;
  }
  if (record.backend == null && record.runtime && typeof record.runtime === 'object') {
    const backend = (record.runtime as { backend?: unknown }).backend;
    if (backend === 'local' || backend === 'remote') record.backend = backend;
  }
  if (record.schemaVersion != null && typeof record.schemaVersion !== 'string') {
    record.schemaVersion = String(record.schemaVersion);
  }
  record.runtime = record.runtime && typeof record.runtime === 'object' && !Array.isArray(record.runtime)
    ? { ...(record.runtime as Record<string, unknown>) }
    : {};
  return record;
}

function stripHistoricalStageFields(record: Record<string, unknown>): Record<string, unknown> {
  const next = { ...record };
  delete next.lastStage;
  delete next.last_stage;
  const runtime = next.runtime && typeof next.runtime === 'object' && !Array.isArray(next.runtime)
    ? { ...(next.runtime as Record<string, unknown>) }
    : {};
  delete runtime.workflow_stage;
  next.runtime = runtime;
  return next;
}

/** Isolated historical-key reader. Discards lastStage / workflow_stage; never exports WorkflowStage. */
export function normalizePersistedRunKeys(raw: unknown): Record<string, unknown> {
  return stripHistoricalStageFields(promotePersistedRunKeys(raw));
}

function stableCanonicalize(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => stableCanonicalize(entry));
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (record[key] === undefined) continue;
    out[key] = stableCanonicalize(record[key]);
  }
  return out;
}

function historicalPayloadFingerprint(raw: unknown): string {
  return JSON.stringify(stableCanonicalize(promotePersistedRunKeys(raw)));
}

function parsePersistedRunV3(raw: unknown, filePath: string): PersistedRunRecord {
  const parsed = PersistedRunRecordV3Schema.safeParse(promotePersistedRunKeys(raw));
  if (!parsed.success) {
    throw new StorageSchemaError(
      `STORAGE_SCHEMA: ${filePath} failed runtime validation: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
  return parsed.data;
}

function mapLegacyFields(
  raw: Record<string, unknown>,
  sessionId: string,
  runId: string,
): Omit<PersistedRunRecord, 'schemaVersion' | 'kind' | 'mission' | 'profileId' | 'diagnostics'> {
  const runtimeRaw = (raw.runtime && typeof raw.runtime === 'object'
    ? raw.runtime
    : {}) as Record<string, unknown>;
  const startedAt = typeof raw.startedAt === 'number'
    ? raw.startedAt
    : Date.parse(String(raw.created_at || raw.createdAt || nowIso()));
  return {
    runId: String(raw.runId || raw.run_id || runId),
    turnId: typeof raw.turnId === 'string' ? raw.turnId : typeof raw.turn_id === 'string' ? raw.turn_id : undefined,
    projectId: String(raw.projectId || raw.project_id || ''),
    sessionId: String(raw.sessionId || raw.session_id || sessionId),
    caseId: String(raw.caseId || raw.case_id || sessionId),
    goal: String(raw.goal || ''),
    captures: Array.isArray(raw.captures) ? raw.captures as CaptureDescriptor[] : [],
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    finishedAt: typeof raw.finishedAt === 'number' ? raw.finishedAt : undefined,
    stoppedAt: typeof raw.stoppedAt === 'number' ? raw.stoppedAt : undefined,
    status: (raw.status as PersistedRunRecord['status']) || 'running',
    stopReason: typeof raw.stopReason === 'string' ? raw.stopReason : undefined,
    backend: ((raw.backend as 'local' | 'remote')
      || (runtimeRaw.backend as 'local' | 'remote')
      || 'local'),
    reportPaths: raw.reportPaths as PersistedRunRecord['reportPaths'],
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : startedAt,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    runtime: {
      backend: ((runtimeRaw.backend as 'local' | 'remote') || 'local'),
      entry_mode: ((runtimeRaw.entry_mode as 'cli' | 'mcp') || 'cli'),
      context_id: (runtimeRaw.context_id as string | null) ?? null,
      runtime_owner: (runtimeRaw.runtime_owner as string | null) ?? null,
      session_id: String(runtimeRaw.session_id || sessionId),
    },
  };
}

export function archiveUnusedSidecars(
  host: StorageHost,
  sessionPath: string,
  runPath: string,
  runId: string,
): string[] {
  const diagnostics: string[] = [];
  for (const relative of CONVERSATION_SIDECARS) {
    const source = path.join(runPath, relative);
    if (!fs.existsSync(source)) continue;
    const bytes = fs.readFileSync(source, 'utf8');
    const ext = source.endsWith('.yaml') || source.endsWith('.yml') ? 'yaml' : 'json';
    archiveRunOriginalBytes(host.io, sessionPath, `${runId}/sidecars/${relative.replace(/[\\/]/g, '_')}`, ext, bytes);
    diagnostics.push(`RUN_V3_SIDECAR_ARCHIVED: ${relative} archived and is not consumed.`);
  }
  return diagnostics;
}

function writeCanonicalV3(host: StorageHost, runPath: string, run: PersistedRunRecord): void {
  const parsed = PersistedRunRecordV3Schema.safeParse(run);
  if (!parsed.success) {
    throw new Error(`STORAGE_SCHEMA: refused to write invalid Run v3: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  }
  host.io.ensureDir(runPath);
  host.io.writeUtf8AtomicFsync(path.join(runPath, 'run.json'), `${JSON.stringify(parsed.data, null, 2)}\n`);
  host.io.writeUtf8AtomicFsync(path.join(runPath, 'run.yaml'), stringifyYaml(parsed.data));
}

function migrateHistoricalRun(
  raw: unknown,
  sessionPath: string,
  sessionId: string,
  runId: string,
): PersistedRunRecord {
  const record = normalizePersistedRunKeys(raw);
  const existingKind = record.kind === 'mission' || record.kind === 'conversation' ? record.kind : null;
  const existingProfile = typeof record.profileId === 'string' && record.profileId.trim()
    ? record.profileId.trim()
    : null;
  const recovery = existingKind && existingProfile
    ? {
        profileId: existingProfile,
        diagnostics: record.mode === undefined
          ? []
          : [`RUN_V3_LEGACY_MODE_IGNORED: old mode ${JSON.stringify(record.mode)} is diagnostic-only and never infers profile or mission.`],
      }
    : recoverRunProfileId(sessionPath, runId, record.mode);
  if (existingKind && existingProfile && existingKind === 'conversation' && recovery.profileId !== existingProfile) {
    recovery.diagnostics.push(
      `RUN_V3_KIND_PRESERVED: persisted kind ${existingKind} kept; conversation/action recovery is diagnostic-only.`,
    );
  }
  const mapped = mapLegacyFields(record, sessionId, runId);
  const migrated = toPersistedRunV3({
    ...mapped,
    profileId: recovery.profileId,
    diagnostics: recovery.diagnostics,
  });
  if (!existingKind && recovery.profileId === 'legacy:unknown') {
    migrated.diagnostics = [
      ...(migrated.diagnostics ?? []),
      'RUN_V3_MISSION_NOT_INFERRED: profile/mission could not be recovered reliably; recorded as conversation. lastStage/workflow_stage were discarded and never used.',
    ];
  }
  const parsed = PersistedRunRecordV3Schema.safeParse(migrated);
  if (!parsed.success) {
    throw new StorageSchemaError(
      `STORAGE_SCHEMA: migrated run ${runId} failed v3 validation: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
  return parsed.data;
}

function readSourceFile(filePath: string, ext: 'json' | 'yaml'): { bytes: string; raw: unknown } {
  const bytes = fs.readFileSync(filePath, 'utf8');
  const raw = ext === 'json' ? JSON.parse(bytes) as unknown : parseYamlDocument(bytes) as unknown;
  return { bytes, raw };
}

function migrateUnlocked(
  host: StorageHost,
  runPath: string,
  sessionPath: string,
  sessionId: string,
  runId: string,
): PersistedRunRecord | null {
  const runJsonPath = path.join(runPath, 'run.json');
  const runYamlPath = path.join(runPath, 'run.yaml');
  const jsonExists = fs.existsSync(runJsonPath);
  const yamlExists = fs.existsSync(runYamlPath);
  if (!jsonExists && !yamlExists) return null;

  const json = jsonExists ? readSourceFile(runJsonPath, 'json') : null;
  const yaml = yamlExists ? readSourceFile(runYamlPath, 'yaml') : null;

  if (json) assertSupportedRunVersion(json.raw, runJsonPath);
  if (yaml) assertSupportedRunVersion(yaml.raw, runYamlPath);

  if (json && yaml && historicalPayloadFingerprint(json.raw) !== historicalPayloadFingerprint(yaml.raw)) {
    throw new StorageSchemaError(
      `RUN_V3_DUAL_FILE_CONFLICT: ${runJsonPath} and ${runYamlPath} disagree on historical payload; refusing to pick silently.`,
    );
  }

  const chosen = json
    ? { ...json, ext: 'json' as const, filePath: runJsonPath }
    : { ...yaml!, ext: 'yaml' as const, filePath: runYamlPath };
  const version = assertSupportedRunVersion(chosen.raw, chosen.filePath);

  if (version === '3') {
    return parsePersistedRunV3(chosen.raw, chosen.filePath);
  }

  archiveRunOriginalBytes(host.io, sessionPath, runId, chosen.ext, chosen.bytes);
  const migrated = migrateHistoricalRun(chosen.raw, sessionPath, sessionId, runId);
  migrated.diagnostics = [
    ...(migrated.diagnostics ?? []),
    ...archiveUnusedSidecars(host, sessionPath, runPath, runId),
  ];
  writeCanonicalV3(host, runPath, migrated);
  return migrated;
}

export function readOrMigratePersistedRun(
  host: StorageHost,
  runPath: string,
  sessionPath: string,
  sessionId: string,
  runId: string,
): PersistedRunRecord | null {
  return withDirectoryFileLockSync(
    sessionPath,
    {
      lockFileName: RUN_V3_MIGRATION_LOCK,
      timeoutCode: 'RUN_V3_MIGRATION_LOCK_TIMEOUT',
    },
    () => migrateUnlocked(host, runPath, sessionPath, sessionId, runId),
  );
}

export { archiveUnusedSidecars as archiveConversationSidecars };
