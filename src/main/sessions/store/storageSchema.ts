import { MaterialContextSchema } from '@shared/types/materialContext';
import { z, type ZodType } from 'zod';
import { REASONING_SELECTIONS } from '@shared/types/modelCapability';
import { CURRENT_STORE_SCHEMA_VERSION, type StorageMigration } from '../../runtime/storedDocument';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ActionEvent } from '@shared/types/evidence';
import type { ExecutionIdentity } from '@shared/types/providerCapability';
import type { RunContextUsageSummary, SessionAttachmentRecord, SessionRecord } from '@shared/types/session';
import type { Message } from '../../agent-runtime/core/types';
import type { SessionContextTurnEntry } from '../../agent-runtime/context/SessionContextJournal';
import type {
  ConversationDeltaRecord,
  ConversationTerminalCommitJournal,
  ConversationTerminalAppendJournal,
  ConversationTurnCommitJournal,
} from './storageCommitTypes';

export const SessionRecordSchema: ZodType<SessionRecord> = z.object({
  schemaVersion: z.unknown().optional(),
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
  }).strict().optional(),
  modelOverride: z.object({
    providerId: z.string().min(1),
    modelId: z.string().min(1),
  }).strict().nullable().optional(),
  agentId: z.string().min(1).optional(),
}).passthrough().superRefine((value, ctx) => {
  const allowed = new Set([
    'schemaVersion', 'sessionId', 'projectId', 'title', 'goal', 'sessionPath', 'createdAt', 'updatedAt',
    'lastRunId', 'turnControls', 'modelOverride', 'agentId',
  ]);
  if (value.schemaVersion !== '1' || Object.keys(value).some((key) => !allowed.has(key))) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'session.json requires schemaVersion 1',
      params: { storageCode: 'STORAGE_SCHEMA_UNSUPPORTED' },
    });
  }
}).transform((value) => ({ ...value, schemaVersion: '1' as const })) as ZodType<SessionRecord>;

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

const TerminalAppendFileSchema = z.object({
  existed: z.boolean(), bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), append: z.string(),
}).strict();

export const ConversationTerminalAppendV2Schema = z.object({
  schemaVersion: z.literal('2'), requestId: z.string().min(1), turnId: z.string().min(1),
  phase: z.enum(['prepared', 'committing', 'committed']),
  history: TerminalAppendFileSchema, context: TerminalAppendFileSchema,
}).strict();

export const CONVERSATION_TERMINAL_COMMIT_MIGRATIONS: StorageMigration<ConversationTerminalCommitJournal | ConversationTerminalAppendJournal>[] = [
  { schemaVersion: '1', schema: ConversationTerminalCommitV1Schema as ZodType<ConversationTerminalCommitJournal> },
  // Both versions are valid recovery protocols; no session-data migration occurs.
  { schemaVersion: '2', schema: z.union([ConversationTerminalCommitV1Schema, ConversationTerminalAppendV2Schema]) as ZodType<ConversationTerminalCommitJournal | ConversationTerminalAppendJournal> },
];

export const SessionAttachmentRecordSchema = z.object({
  material: MaterialContextSchema.optional(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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

export const SessionAttachmentManifestSchema = z.object({
  schemaVersion: z.literal(CURRENT_STORE_SCHEMA_VERSION),
  attachments: SessionAttachmentRecordsSchema,
}).strict().transform((document) => document.attachments) as ZodType<SessionAttachmentRecord[]>;

export {
  PersistedRunRecordV3Schema as PersistedRunRecordSchema,
} from '../run/runV3/runRecordSchema';

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
}).strict() as ZodType<RunContextUsageSummary>;

export interface SessionUsageDocument {
  schemaVersion: string;
  usage: RunContextUsageSummary;
}

export const CURRENT_USAGE_SCHEMA_VERSION = '2';

export const SessionUsageV2Schema = z.object({
  schemaVersion: z.literal('2'),
  usage: RunContextUsageSummarySchema,
}).strict();

export function toSessionUsageManifest(usage: RunContextUsageSummary): SessionUsageDocument {
  return { schemaVersion: CURRENT_USAGE_SCHEMA_VERSION, usage };
}

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

const isObjectValue = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonBlank = z.string().refine((value) => value.trim().length > 0, 'must not be blank');

export const ActionEventSchema: ZodType<ActionEvent> = z.object({
  schema_version: z.string(),
  event_id: z.string(),
  turn_id: z.string().optional(),
  ts_ms: z.number(),
  run_id: z.string(),
  session_id: z.string(),
  agent_id: z.string(),
  event_type: z.string(),
  status: z.enum(['ok', 'error', 'sent', 'pass', 'fail', 'blocked', 'entered', 'warning', 'timeout', 'completed']),
  duration_ms: z.number(),
  refs: z.array(z.string()),
  payload: z.record(z.string(), z.unknown()),
});

/**
 * The top-level fields of a stored conversation message. Its work trace is read back through `readStoredWorkTrace`;
 * attachments, diagnostics and plan references are passed through as this store wrote them.
 */
const ConversationMessageEnvelopeSchema = z.object({
  id: z.string(),
  turnId: z.string(),
  sessionId: z.string().nullable(),
  projectId: z.string().nullable(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  status: z.enum(['draft', 'streaming', 'complete', 'error', 'stopped']).optional(),
  createdAt: z.number(),
  updatedAt: z.number().optional(),
}).passthrough();
const ConversationDeltaEnvelopeSchema = z.object({
  op: z.literal('delta'),
  id: z.string(),
  patch: z.record(z.string(), z.unknown()),
  traceBlocks: z.record(z.string(), z.unknown()).optional(),
  updatedAt: z.number(),
}).passthrough();

/** One conversation.jsonl line: a full message snapshot or a delta patch over one. */
export const ConversationHistoryRecordSchema = z.union([
  z.custom<ConversationDeltaRecord>((value) => ConversationDeltaEnvelopeSchema.safeParse(value).success, 'invalid conversation delta record'),
  z.custom<ConversationMessage>((value) => ConversationMessageEnvelopeSchema.safeParse(value).success, 'invalid conversation message record'),
]);

const ExecutionFingerprintSchema = z.object({ fingerprint: nonBlank });

/**
 * One session-context.jsonl line. Its messages and execution identity are the ones the turn committed; they are
 * checked to be the records this store wrote, and every field the journal readers use is validated.
 */
export const SessionContextTurnEntrySchema: ZodType<SessionContextTurnEntry> = z.object({
  schemaVersion: z.literal(2),
  turnId: nonBlank,
  userMessageId: nonBlank,
  assistantMessageId: nonBlank,
  branchId: nonBlank,
  agentId: z.string(),
  executionIdentity: z.custom<ExecutionIdentity>((value) => ExecutionFingerprintSchema.safeParse(value).success, 'execution identity requires a fingerprint'),
  controls: z.object({ reasoningLevel: z.enum(REASONING_SELECTIONS), maxContextMode: z.boolean(), fastModel: z.boolean() }),
  status: z.enum(['complete', 'stopped', 'error']),
  messages: z.array(z.custom<Message>(isObjectValue, 'context message must be an object')),
  createdAt: z.number(),
  completedAt: z.number(),
  approvedExecutionCompletion: z.object({ offerId: z.string().optional(), planUri: z.string(), planHash: z.string() }).optional(),
});
