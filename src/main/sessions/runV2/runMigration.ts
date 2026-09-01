import fs from 'fs';
import path from 'path';
import { parse as parseYamlDocument } from 'yaml';
import { normalizeWorkflowStage } from '@shared/constants/stages';
import { nowIso } from '@shared/utils/id';
import type { CaptureDescriptor } from '@shared/types/session';
import { StorageSchemaError } from '../storageSchema';
import type { PersistedRunRecord } from '../storageTypes';
import type { StorageHost } from '../storageHost';
import { archiveRunOriginalBytes } from './runArchive';
import { recoverRunProfileId } from './runProfileRecovery';
import { PersistedRunRecordV2Schema, toPersistedRunV2 } from './runRecordSchema';

const CONVERSATION_SIDECARS = [
  'capture_refs.yaml',
  path.join('notes', 'hypothesis_board.yaml'),
];

function readSchemaVersion(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.schemaVersion === 'string') return record.schemaVersion;
  if (typeof record.schema_version === 'string') return record.schema_version;
  if (typeof record.schemaVersion === 'number') return String(record.schemaVersion);
  if (typeof record.schema_version === 'number') return String(record.schema_version);
  return null;
}

function assertSupportedRunVersion(raw: unknown, filePath: string): '0' | '1' | '2' | null {
  const version = readSchemaVersion(raw);
  if (version === null) return null;
  if (version === '0' || version === '1' || version === '2') return version;
  throw new StorageSchemaError(
    `STORAGE_SCHEMA_UNSUPPORTED: ${filePath} has schemaVersion ${version}; only 0, 1, and 2 are supported`,
  );
}

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

export function normalizePersistedRunKeys(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  const next: Record<string, unknown> = { ...record };
  for (const [snake, camel] of Object.entries(SNAKE_TO_CAMEL)) {
    if (next[camel] == null && next[snake] != null) {
      next[camel] = next[snake];
    }
  }
  for (const key of ['createdAt', 'updatedAt', 'startedAt', 'finishedAt', 'stoppedAt']) {
    if (typeof next[key] === 'string') {
      const parsed = Date.parse(next[key] as string);
      if (Number.isFinite(parsed)) next[key] = parsed;
    }
  }
  if (typeof next.startedAt !== 'number' && typeof next.createdAt === 'number') {
    next.startedAt = next.createdAt;
  }
  if (next.backend == null && next.runtime && typeof next.runtime === 'object') {
    const backend = (next.runtime as { backend?: unknown }).backend;
    if (backend === 'local' || backend === 'remote') next.backend = backend;
  }
  if (next.schemaVersion != null && typeof next.schemaVersion !== 'string') {
    next.schemaVersion = String(next.schemaVersion);
  }
  return next;
}

function parsePersistedRunV2(raw: unknown, filePath: string): PersistedRunRecord {
  const parsed = PersistedRunRecordV2Schema.safeParse(normalizePersistedRunKeys(raw));
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
    lastStage: normalizeWorkflowStage(String(raw.lastStage || raw.last_stage || 'preflight')),
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
      workflow_stage: normalizeWorkflowStage(runtimeRaw.workflow_stage as string | undefined),
    },
  };
}

export function archiveConversationSidecars(
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
    diagnostics.push(`RUN_V2_SIDECAR_ARCHIVED: ${relative} archived and is not consumed.`);
  }
  return diagnostics;
}

export function readOrMigratePersistedRun(
  host: StorageHost,
  runPath: string,
  sessionPath: string,
  sessionId: string,
  runId: string,
): PersistedRunRecord | null {
  const runJsonPath = path.join(runPath, 'run.json');
  const runYamlPath = path.join(runPath, 'run.yaml');
  if (fs.existsSync(runJsonPath)) {
    const bytes = fs.readFileSync(runJsonPath, 'utf8');
    const raw = JSON.parse(bytes) as unknown;
    const version = assertSupportedRunVersion(raw, runJsonPath);
    if (version === '2') {
      return parsePersistedRunV2(raw, runJsonPath);
    }
    archiveRunOriginalBytes(host.io, sessionPath, runId, 'json', bytes);
    const migrated = migrateLegacyRun(raw, sessionPath, sessionId, runId);
    if (migrated.kind === 'conversation') {
      migrated.diagnostics = [
        ...(migrated.diagnostics ?? []),
        ...archiveConversationSidecars(host, sessionPath, runPath, runId),
      ];
    }
    host.io.writeJsonAtomic(runJsonPath, migrated);
    return migrated;
  }

  if (!fs.existsSync(runYamlPath)) return null;
  const bytes = fs.readFileSync(runYamlPath, 'utf8');
  const raw = parseYamlDocument(bytes) as unknown;
  const version = assertSupportedRunVersion(raw, runYamlPath);
  if (version === '2') {
    return parsePersistedRunV2(raw, runYamlPath);
  }
  archiveRunOriginalBytes(host.io, sessionPath, runId, 'yaml', bytes);
  const migrated = migrateLegacyRun(raw, sessionPath, sessionId, runId);
  if (migrated.kind === 'conversation') {
    migrated.diagnostics = [
      ...(migrated.diagnostics ?? []),
      ...archiveConversationSidecars(host, sessionPath, runPath, runId),
    ];
  }
  host.io.writeJsonAtomic(runJsonPath, migrated);
  return migrated;
}

function migrateLegacyRun(
  raw: unknown,
  sessionPath: string,
  sessionId: string,
  runId: string,
): PersistedRunRecord {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const recovery = recoverRunProfileId(sessionPath, runId, record.mode);
  const mapped = mapLegacyFields(record, sessionId, runId);
  const migrated = toPersistedRunV2({
    ...mapped,
    profileId: recovery.profileId,
    diagnostics: recovery.diagnostics,
  });
  const parsed = PersistedRunRecordV2Schema.safeParse(migrated);
  if (!parsed.success) {
    throw new StorageSchemaError(
      `STORAGE_SCHEMA: migrated run ${runId} failed v2 validation: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
  return parsed.data;
}
