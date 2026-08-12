import { z, type ZodType } from 'zod';
import type { SessionAttachmentRecord, SessionRecord } from '@shared/types/session';
import type { PersistedRunRecord } from './storageTypes';
import type {
  ConversationTerminalCommitJournal,
  ConversationTurnCommitJournal,
} from './storageCommitTypes';

export class StorageSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageSchemaError';
  }
}

export interface StorageMigration<T> {
  schemaVersion: string;
  schema: ZodType<T>;
  migrate?: (raw: unknown) => unknown;
}

function readSchemaVersion(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.schemaVersion === 'string') return record.schemaVersion;
  if (typeof record.schema_version === 'string') return record.schema_version;
  if (typeof record.schemaVersion === 'number') return String(record.schemaVersion);
  if (typeof record.schema_version === 'number') return String(record.schema_version);
  return null;
}

export function parseStoredDocument<T>(
  raw: unknown,
  migrations: readonly StorageMigration<T>[],
  filePath: string,
): T {
  if (migrations.length === 0) {
    throw new StorageSchemaError(`STORAGE_SCHEMA: no migrations registered for ${filePath}`);
  }
  const current = migrations[migrations.length - 1]!;
  const version = readSchemaVersion(raw);
  if (version === null) {
    throw new StorageSchemaError(`STORAGE_SCHEMA: missing schemaVersion in ${filePath}`);
  }

  const known = migrations.find((entry) => entry.schemaVersion === version);
  if (!known) {
    const knownVersions = migrations.map((entry) => entry.schemaVersion);
    const numeric = Number(version);
    const currentNumeric = Number(current.schemaVersion);
    if (Number.isFinite(numeric) && Number.isFinite(currentNumeric) && numeric > currentNumeric) {
      throw new StorageSchemaError(
        `STORAGE_SCHEMA_UNSUPPORTED: ${filePath} has schemaVersion ${version}; supported up to ${current.schemaVersion}`,
      );
    }
    throw new StorageSchemaError(
      `STORAGE_SCHEMA: unknown schemaVersion ${version} in ${filePath} (known: ${knownVersions.join(', ')})`,
    );
  }

  let candidate: unknown = raw;
  const startIndex = migrations.findIndex((entry) => entry.schemaVersion === version);
  for (let index = startIndex; index < migrations.length; index += 1) {
    const step = migrations[index]!;
    if (step.migrate && index < migrations.length - 1) {
      candidate = step.migrate(candidate);
    }
  }

  const parsed = current.schema.safeParse(candidate);
  if (!parsed.success) {
    throw new StorageSchemaError(
      `STORAGE_SCHEMA: ${filePath} failed runtime validation: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`,
    );
  }
  return parsed.data;
}

const ProjectInputSchema = z.object({
  inputId: z.string().min(1),
  fileName: z.string().min(1),
  filePath: z.string().min(1),
  source: z.literal('project_resource'),
  discoveredAt: z.number(),
  lastModifiedAt: z.number(),
  size: z.number(),
}).passthrough();

const ProjectRecordSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1),
  rootPath: z.string().min(1),
  slug: z.string().min(1),
  resourcePath: z.string().min(1),
  knowledgePath: z.string().min(1),
  inputsPath: z.string().min(1),
  inputs: z.array(ProjectInputSchema).default([]),
  inputsUpdatedAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastSessionId: z.string().optional(),
}).passthrough();

export const ProjectRegistryV1Schema = z.object({
  schemaVersion: z.literal('1'),
  projects: z.array(ProjectRecordSchema),
});

export const PROJECT_REGISTRY_MIGRATIONS: StorageMigration<z.infer<typeof ProjectRegistryV1Schema>>[] = [
  { schemaVersion: '1', schema: ProjectRegistryV1Schema },
];

export const SelectionStateSchema = z.object({
  projectId: z.string().nullable(),
  sessionId: z.string().nullable(),
});

export const SessionRecordSchema: ZodType<SessionRecord> = z.object({
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string(),
  goal: z.string(),
  sessionPath: z.string().min(1),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastRunId: z.string().optional(),
}).passthrough() as ZodType<SessionRecord>;

export const SessionEvidenceV1Schema = z.object({
  schema_version: z.literal('1'),
  session_id: z.string().min(1),
  project_id: z.string().min(1),
  latest_run_id: z.string().nullable(),
  latest_run_status: z.string().nullable(),
  latest_stage: z.string().nullable(),
  updated_at: z.string(),
  event_counts: z.record(z.string(), z.number()),
  active_blockers: z.array(z.unknown()),
}).passthrough();

export const SESSION_EVIDENCE_MIGRATIONS: StorageMigration<z.infer<typeof SessionEvidenceV1Schema>>[] = [
  { schemaVersion: '1', schema: SessionEvidenceV1Schema },
];

export const ConversationTurnCommitV1Schema = z.object({
  schemaVersion: z.literal('1'),
  requestId: z.string().min(1),
  turnId: z.string().min(1),
  phase: z.enum(['prepared', 'committing', 'committed']),
  beforeHistory: z.array(z.unknown()),
  beforeBranch: z.unknown().nullable(),
  beforeAttachments: z.array(z.unknown()),
  afterHistory: z.array(z.unknown()).optional(),
  afterBranch: z.unknown().optional(),
  afterAttachments: z.array(z.unknown()),
  importedPaths: z.array(z.string()),
}).passthrough();

export const CONVERSATION_TURN_COMMIT_MIGRATIONS: StorageMigration<ConversationTurnCommitJournal>[] = [
  { schemaVersion: '1', schema: ConversationTurnCommitV1Schema as ZodType<ConversationTurnCommitJournal> },
];

export const ConversationTerminalCommitV1Schema = z.object({
  schemaVersion: z.literal('1'),
  requestId: z.string().min(1),
  turnId: z.string().min(1),
  phase: z.enum(['prepared', 'committing', 'committed']),
  beforeHistory: z.array(z.unknown()),
  beforeBranch: z.unknown().nullable(),
  beforeContext: z.array(z.unknown()),
  afterHistory: z.array(z.unknown()),
  afterBranch: z.unknown().nullable(),
  afterContext: z.array(z.unknown()),
}).passthrough();

export const CONVERSATION_TERMINAL_COMMIT_MIGRATIONS: StorageMigration<ConversationTerminalCommitJournal>[] = [
  { schemaVersion: '1', schema: ConversationTerminalCommitV1Schema as ZodType<ConversationTerminalCommitJournal> },
];

export const SessionAttachmentRecordSchema = z.object({
  attachmentId: z.string().min(1),
  sessionId: z.string().min(1),
  projectId: z.string().min(1),
  kind: z.enum(['image', 'file']),
  fileName: z.string().min(1),
  filePath: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number(),
  createdAt: z.number(),
}).passthrough();

export const SessionAttachmentManifestSchema: ZodType<SessionAttachmentRecord[]> = z.array(SessionAttachmentRecordSchema) as ZodType<SessionAttachmentRecord[]>;

export const PersistedRunRecordSchema: ZodType<PersistedRunRecord> = z.object({
  runId: z.string().min(1),
  turnId: z.string().optional(),
  projectId: z.string().min(1),
  sessionId: z.string().min(1),
  caseId: z.string().min(1),
  mode: z.enum(['debugger', 'analyzer', 'optimizer']),
  goal: z.string(),
  captures: z.array(z.unknown()),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  stoppedAt: z.number().optional(),
  status: z.enum([
    'queued',
    'planning',
    'awaiting_input',
    'awaiting_approval',
    'running',
    'stopping',
    'completed',
    'failed',
    'cancelled',
    'interrupted',
  ]),
  stopReason: z.string().optional(),
  lastStage: z.string(),
  backend: z.enum(['local', 'remote']),
  reportPaths: z.unknown().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
  runtime: z.object({
    backend: z.enum(['local', 'remote']),
    entry_mode: z.enum(['cli', 'mcp']),
    context_id: z.string().nullable(),
    runtime_owner: z.string().nullable(),
    session_id: z.string().min(1),
    workflow_stage: z.string(),
  }).passthrough(),
}).passthrough() as ZodType<PersistedRunRecord>;
