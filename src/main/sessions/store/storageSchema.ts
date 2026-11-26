import { z, type ZodType } from 'zod';
import { MaterialContextSchema } from '@shared/types/materialContext';
import { RunContextUsageSummarySchema } from '@shared/types/session';
import { REASONING_SELECTIONS } from '@shared/types/modelCapability';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ExecutionIdentity } from '@shared/types/providerCapability';
import type { RunContextUsageSummary, SessionAttachmentRecord, SessionRecord } from '@shared/types/session';
import type { Message } from '../../agent-runtime/core/types';
import type { SessionContextTurnEntry } from '../../agent-runtime/context/SessionContextJournal';
import type {
  ConversationDeltaRecord,
  ConversationTerminalAppendJournal,
  ConversationTurnCommitJournal,
} from './storageCommitTypes';

export const SessionRecordSchema: ZodType<SessionRecord> = z
  .object({
    sessionId: z.string().min(1),
    projectId: z.string().min(1),
    title: z.string(),
    goal: z.string(),
    sessionPath: z.string().min(1),
    createdAt: z.number(),
    updatedAt: z.number(),
    lastRunId: z.string().optional(),
    turnControls: z
      .object({
        reasoningLevel: z.string(),
        maxContextMode: z.boolean(),
        fastModel: z.boolean(),
      })
      .strict()
      .optional(),
    modelOverride: z
      .object({
        providerId: z.string().min(1),
        modelId: z.string().min(1),
      })
      .strict()
      .nullable()
      .optional(),
    agentId: z.string().min(1).optional(),
  })
  .strict() as ZodType<SessionRecord>;

export const ConversationTurnCommitSchema = z
  .object({
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
  })
  .strict() as ZodType<ConversationTurnCommitJournal>;

const TerminalAppendFileSchema = z
  .object({
    existed: z.boolean(),
    bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    append: z.string(),
  })
  .strict();

export const ConversationTerminalAppendSchema: ZodType<ConversationTerminalAppendJournal> = z
  .object({
    requestId: z.string().min(1),
    turnId: z.string().min(1),
    phase: z.enum(['prepared', 'committing', 'committed']),
    history: TerminalAppendFileSchema,
    context: TerminalAppendFileSchema,
  })
  .strict();

export const SessionAttachmentRecordSchema = z
  .object({
    material: MaterialContextSchema.optional(),
    sourceHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
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
  })
  .passthrough();

const SessionAttachmentRecordsSchema = z.array(SessionAttachmentRecordSchema);

export interface SessionAttachmentManifestDocument {
  attachments: SessionAttachmentRecord[];
}

export function toSessionAttachmentManifest(attachments: SessionAttachmentRecord[]): SessionAttachmentManifestDocument {
  return { attachments };
}

export const SessionAttachmentManifestSchema = z
  .object({
    attachments: SessionAttachmentRecordsSchema,
  })
  .strict()
  .transform((document) => document.attachments) as ZodType<SessionAttachmentRecord[]>;

export interface SessionUsageDocument {
  usage: RunContextUsageSummary;
}

export const SessionUsageSchema = z
  .object({
    usage: RunContextUsageSummarySchema,
  })
  .strict();

export function toSessionUsageManifest(usage: RunContextUsageSummary): SessionUsageDocument {
  return { usage };
}

export interface SessionShellState {
  cwd: string;
}

export interface SessionShellStateDocument {
  state: SessionShellState;
}

export const SessionShellStateSchema = z
  .object({
    state: z
      .object({
        cwd: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export function toSessionShellStateManifest(state: SessionShellState): SessionShellStateDocument {
  return { state };
}

const isObjectValue = (value: unknown): boolean => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonBlank = z.string().refine((value) => value.trim().length > 0, 'must not be blank');

/**
 * The top-level fields of a stored conversation message. Its work trace is read back through `readStoredWorkTrace`;
 * attachments, diagnostics and plan references are passed through as this store wrote them.
 */
const ConversationMessageEnvelopeSchema = z
  .object({
    id: z.string(),
    turnId: z.string(),
    sessionId: z.string().nullable(),
    projectId: z.string().nullable(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
    status: z.enum(['draft', 'streaming', 'complete', 'error', 'stopped']).optional(),
    createdAt: z.number(),
    updatedAt: z.number().optional(),
  })
  .passthrough();
const ConversationDeltaEnvelopeSchema = z
  .object({
    op: z.literal('delta'),
    id: z.string(),
    patch: z.record(z.string(), z.unknown()),
    traceBlocks: z.record(z.string(), z.unknown()).optional(),
    updatedAt: z.number(),
  })
  .passthrough();

/** One conversation.jsonl line: a full message snapshot or a delta patch over one. */
export const ConversationHistoryRecordSchema = z.union([
  z.custom<ConversationDeltaRecord>(
    (value) => ConversationDeltaEnvelopeSchema.safeParse(value).success,
    'invalid conversation delta record',
  ),
  z.custom<ConversationMessage>(
    (value) => ConversationMessageEnvelopeSchema.safeParse(value).success,
    'invalid conversation message record',
  ),
]);

const ExecutionFingerprintSchema = z.object({ fingerprint: nonBlank });

/**
 * One session-context.jsonl line. Its messages and execution identity are the ones the turn committed; they are
 * checked to be the records this store wrote, and every field the journal readers use is validated.
 */
export const SessionContextTurnEntrySchema: ZodType<SessionContextTurnEntry> = z
  .object({
    turnId: nonBlank,
    userMessageId: nonBlank,
    assistantMessageId: nonBlank,
    branchId: nonBlank,
    agentId: z.string(),
    executionIdentity: z.custom<ExecutionIdentity>(
      (value) => ExecutionFingerprintSchema.safeParse(value).success,
      'execution identity requires a fingerprint',
    ),
    controls: z.object({
      reasoningLevel: z.enum(REASONING_SELECTIONS),
      maxContextMode: z.boolean(),
      fastModel: z.boolean(),
    }),
    status: z.enum(['complete', 'stopped', 'error']),
    messages: z.array(z.custom<Message>(isObjectValue, 'context message must be an object')),
    createdAt: z.number(),
    completedAt: z.number(),
    approvedExecutionCompletion: z
      .object({ offerId: z.string().optional(), planUri: z.string(), planHash: z.string() })
      .optional(),
  })
  .strict();
