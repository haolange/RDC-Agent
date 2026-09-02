import { z, type ZodType } from 'zod';
import type { RunContextUsageSummary, SessionAttachmentRecord, SessionRecord } from '@shared/types/session';
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

function isBareDerivedContextView(raw: unknown): boolean {
  return Boolean(
    raw
    && typeof raw === 'object'
    && !Array.isArray(raw)
    && 'viewId' in raw
    && 'handoff' in raw
    && !('view' in raw),
  );
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

export const CURRENT_STORE_SCHEMA_VERSION = '1';

export function assertNoUnsupportedSchemaVersion(
  raw: unknown,
  currentVersion: string,
  filePath: string,
): void {
  const version = readSchemaVersion(raw);
  if (version === null) return;
  const numeric = Number(version);
  const currentNumeric = Number(currentVersion);
  if (Number.isFinite(numeric) && Number.isFinite(currentNumeric) && numeric > currentNumeric) {
    throw new StorageSchemaError(
      `STORAGE_SCHEMA_UNSUPPORTED: ${filePath} has schemaVersion ${version}; supported up to ${currentVersion}`,
    );
  }
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
  let version = isBareDerivedContextView(raw) && migrations.some((entry) => entry.schemaVersion === '0')
    ? '0'
    : readSchemaVersion(raw);
  if (version === null) {
    if (migrations.some((entry) => entry.schemaVersion === '0')) {
      version = '0';
    } else {
      throw new StorageSchemaError(`STORAGE_SCHEMA: missing schemaVersion in ${filePath}`);
    }
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
  turnControls: z.object({
    reasoningLevel: z.string(),
    maxContextMode: z.boolean(),
    fastModel: z.boolean(),
  }).optional(),
  modelOverride: z.object({
    providerId: z.string().min(1),
    modelId: z.string().min(1),
  }).nullable().optional(),
  agentId: z.string().min(1).optional(),
}).passthrough() as ZodType<SessionRecord>;

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
  layer: z.enum(['image', 'text', 'pdf', 'binary']).optional(),
  fileName: z.string().min(1),
  filePath: z.string().min(1),
  mimeType: z.string().min(1),
  size: z.number(),
  createdAt: z.number(),
}).passthrough();

const SessionAttachmentRecordsSchema = z.array(SessionAttachmentRecordSchema);

export interface SessionAttachmentManifestDocument {
  schemaVersion: string;
  attachments: SessionAttachmentRecord[];
}

export function toSessionAttachmentManifest(
  attachments: SessionAttachmentRecord[],
): SessionAttachmentManifestDocument {
  return { schemaVersion: CURRENT_STORE_SCHEMA_VERSION, attachments };
}

function unwrapAttachmentManifest(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && 'attachments' in raw) {
    return (raw as { attachments: unknown }).attachments;
  }
  return raw;
}

/** Accepts current `{ schemaVersion, attachments }` and legacy bare arrays. */
export const SessionAttachmentManifestSchema = z
  .unknown()
  .transform((raw) => unwrapAttachmentManifest(raw))
  .pipe(SessionAttachmentRecordsSchema) as unknown as ZodType<SessionAttachmentRecord[]>;

export {
  PersistedRunRecordV3Schema as PersistedRunRecordSchema,
  SESSION_RUN_MIGRATIONS,
} from './runV3/runRecordSchema';

const ContextUsageBreakdownEntrySchema = z.object({
  id: z.string().min(1),
  tokens: z.number(),
  count: z.number().optional(),
}).passthrough();

const LlmUsageCostSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
  total: z.number(),
}).passthrough();

const UsageCoreFields = {
  runId: z.string().min(1),
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  promptBudgetTokens: z.number().nullable(),
  contextWindowTokens: z.number().nullable(),
  usagePercent: z.number(),
  occupiedTokens: z.number(),
  breakdown: z.array(ContextUsageBreakdownEntrySchema).nullable(),
  snapshotAt: z.number().nullable(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
  cacheHitTokens: z.number().optional(),
  cacheMissTokens: z.number().optional(),
  lastTurnCacheHitTokens: z.number().optional(),
  lastTurnCacheMissTokens: z.number().optional(),
  cacheSavedTokens: z.number().optional(),
  lastTurnCacheHitRate: z.number().optional(),
  cumulativeCacheHitRate: z.number().optional(),
  reasoningTokens: z.number().optional(),
  cost: LlmUsageCostSchema.optional(),
  cumulativeCost: z.number().optional(),
};

export const RunContextUsageSummarySchema: ZodType<RunContextUsageSummary> = z.object({
  ...UsageCoreFields,
  maxOutputTokens: z.number().nullable(),
  compactionThresholdTokens: z.number().nullable(),
}).passthrough() as ZodType<RunContextUsageSummary>;

export interface SessionUsageDocument {
  schemaVersion: string;
  usage: RunContextUsageSummary;
}

export const CURRENT_USAGE_SCHEMA_VERSION = '2';

export const SessionUsageV1Schema = z.object({
  schemaVersion: z.literal('1'),
  usage: z.object({
    ...UsageCoreFields,
    outputReserveTokens: z.number().nullable(),
  }).passthrough(),
});

export const SessionUsageV2Schema = z.object({
  schemaVersion: z.literal('2'),
  usage: RunContextUsageSummarySchema,
});

function migrateSessionUsageV0(raw: unknown): unknown {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {};
  const nested = record.usage;
  const legacy = nested && typeof nested === 'object' && !Array.isArray(nested)
    ? { ...(nested as Record<string, unknown>) }
    : record;
  delete legacy.schemaVersion;
  delete legacy.usage;
  const oldWindow = typeof legacy.contextWindowTokens === 'number' ? legacy.contextWindowTokens : null;
  const promptBudgetTokens = typeof legacy.promptBudgetTokens === 'number'
    ? legacy.promptBudgetTokens
    : oldWindow;
  return {
    schemaVersion: '1',
    usage: {
      ...legacy,
      promptBudgetTokens,
      contextWindowTokens: null,
      outputReserveTokens: null,
    },
  };
}

function migrateSessionUsageV1(raw: unknown): unknown {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>) }
    : {};
  const nested = record.usage && typeof record.usage === 'object' && !Array.isArray(record.usage)
    ? { ...(record.usage as Record<string, unknown>) }
    : {};
  const maxOutputTokens = typeof nested.maxOutputTokens === 'number'
    ? nested.maxOutputTokens
    : typeof nested.outputReserveTokens === 'number'
      ? nested.outputReserveTokens
      : null;
  delete nested.outputReserveTokens;
  return {
    schemaVersion: CURRENT_USAGE_SCHEMA_VERSION,
    usage: {
      ...nested,
      maxOutputTokens,
      compactionThresholdTokens: typeof nested.compactionThresholdTokens === 'number'
        ? nested.compactionThresholdTokens
        : null,
    },
  };
}

export function toSessionUsageManifest(usage: RunContextUsageSummary): SessionUsageDocument {
  return { schemaVersion: CURRENT_USAGE_SCHEMA_VERSION, usage };
}

export const SESSION_USAGE_MIGRATIONS: StorageMigration<SessionUsageDocument>[] = [
  {
    schemaVersion: '0',
    schema: z.object({}).passthrough() as unknown as ZodType<SessionUsageDocument>,
    migrate: migrateSessionUsageV0,
  },
  {
    schemaVersion: '1',
    schema: SessionUsageV1Schema as unknown as ZodType<SessionUsageDocument>,
    migrate: migrateSessionUsageV1,
  },
  {
    schemaVersion: '2',
    schema: SessionUsageV2Schema as ZodType<SessionUsageDocument>,
  },
];

const DerivedContextViewSchema = z.object({
  schemaVersion: z.literal(1),
  viewId: z.string().min(1),
  scope: z.enum(['ephemeral', 'session']),
  sessionId: z.string().optional(),
  branchId: z.string().optional(),
  sourceTurnIds: z.array(z.string()),
  retainedTurnIds: z.array(z.string()),
  sourceHash: z.string().min(1),
  handoff: z.object({
    schemaVersion: z.literal(1),
    handoffId: z.string().min(1),
    kind: z.string().min(1),
    derivation: z.enum(['model-generated', 'deterministic-extractive']).optional(),
    objective: z.string(),
    decisions: z.array(z.unknown()),
    constraints: z.array(z.unknown()),
    facts: z.array(z.unknown()),
    openWork: z.array(z.unknown()),
    resourceRefs: z.array(z.unknown()),
    source: z.object({
      turnIds: z.array(z.string()),
      messageCount: z.number(),
      messageHashes: z.array(z.string()),
      sourceHash: z.string().min(1),
    }).passthrough(),
    contentHash: z.string().min(1),
  }).passthrough(),
  createdAt: z.number(),
}).passthrough();

export interface SessionContextViewDocument {
  schemaVersion: string;
  view: import('@shared/types/semanticContext').DerivedContextView;
}

export const CURRENT_CONTEXT_VIEW_SCHEMA_VERSION = '1';

export const SessionContextViewV1Schema = z.object({
  schemaVersion: z.literal('1'),
  view: DerivedContextViewSchema,
});

function migrateSessionContextViewV0(raw: unknown): unknown {
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && 'viewId' in raw && 'handoff' in raw) {
    const view = raw as { handoff?: Record<string, unknown> };
    const handoff = view.handoff && typeof view.handoff === 'object' && !Array.isArray(view.handoff)
      ? {
          derivation: 'deterministic-extractive',
          ...view.handoff,
        }
      : view.handoff;
    return { schemaVersion: CURRENT_CONTEXT_VIEW_SCHEMA_VERSION, view: { ...view, handoff } };
  }
  return raw;
}

export function toSessionContextViewManifest(
  view: import('@shared/types/semanticContext').DerivedContextView,
): SessionContextViewDocument {
  return { schemaVersion: CURRENT_CONTEXT_VIEW_SCHEMA_VERSION, view };
}

export const SESSION_CONTEXT_VIEW_MIGRATIONS: StorageMigration<SessionContextViewDocument>[] = [
  {
    schemaVersion: '0',
    schema: z.object({}).passthrough() as unknown as ZodType<SessionContextViewDocument>,
    migrate: migrateSessionContextViewV0,
  },
  {
    schemaVersion: '1',
    schema: SessionContextViewV1Schema as unknown as ZodType<SessionContextViewDocument>,
  },
];

export interface SessionShellState {
  cwd: string;
}

export interface SessionShellStateDocument {
  schemaVersion: string;
  state: SessionShellState;
}

export const CURRENT_SHELL_STATE_SCHEMA_VERSION = '1';

export const SessionShellStateV1Schema = z.object({
  schemaVersion: z.literal('1'),
  state: z.object({
    cwd: z.string().min(1),
  }),
});

export function toSessionShellStateManifest(state: SessionShellState): SessionShellStateDocument {
  return { schemaVersion: CURRENT_SHELL_STATE_SCHEMA_VERSION, state };
}

export const SESSION_SHELL_STATE_MIGRATIONS: StorageMigration<SessionShellStateDocument>[] = [
  {
    schemaVersion: '1',
    schema: SessionShellStateV1Schema as ZodType<SessionShellStateDocument>,
  },
];
