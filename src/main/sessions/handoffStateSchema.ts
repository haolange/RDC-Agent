import { HandoffContractSchema } from '@shared/types/handoffContract';
import { z, type ZodType } from 'zod';
import type { HandoffStateDocument, ProfileHandoffState } from '@shared/types/profileHandoff';
import type { StorageMigration } from './storageSchema';

export const CURRENT_HANDOFF_STATE_SCHEMA_VERSION = '2';

const ProfileHandoffLifecycleSchema = z.enum(['prepared', 'committed', 'consumed', 'cancelled']);

const ProfileHandoffCancelReasonSchema = z.enum([
  'user_stop',
  'rewrite',
  'branch',
  'manual_switch',
  'session_close',
  'restart_degrade',
  'invalid_model',
  'depth_exceeded',
  'superseded',
]);

export const ProfileHandoffStateSchema: ZodType<ProfileHandoffState> = z.object({
  handoffId: z.string().min(1),
  lifecycle: ProfileHandoffLifecycleSchema,
  sourceTurnId: z.string().min(1),
  sourceRequestId: z.string().min(1),
  sourceAgentId: z.string().min(1),
  toAgentId: z.string().min(1),
  chainRoot: z.string().min(1),
  depth: z.number().int().positive(),
  contract: HandoffContractSchema,
  prompt: z.string().trim().min(1),
  label: z.string(),
  declaredModel: z.string().min(1).nullable(),
  send: z.boolean(),
  preparedAt: z.number(),
  committedAt: z.number().optional(),
  consumedAt: z.number().optional(),
  cancelledAt: z.number().optional(),
  cancelReason: ProfileHandoffCancelReasonSchema.optional(),
  continuationTurnId: z.string().min(1).optional(),
  taskExecution: z.object({
    taskId: z.string().min(1),
    executionId: z.string().min(1),
    generation: z.number().int().positive(),
    taskRevision: z.number().int().positive(),
  }).strict().optional(),
  taskResult: z.object({
    disposition: z.enum(['completed', 'partial', 'blocked', 'cancelled']),
    summary: z.string().min(1),
    outputs: z.record(z.string(), z.string()),
  }).strict().optional(),
});

export const HandoffStateDocumentV2Schema = z.object({
  schemaVersion: z.literal('2'),
  migrationNotice: z.string().min(1).optional(),
  active: ProfileHandoffStateSchema.nullable(),
  history: z.array(ProfileHandoffStateSchema).optional(),
});

export const HANDOFF_STATE_MIGRATIONS: StorageMigration<HandoffStateDocument>[] = [
  { schemaVersion: '2', schema: HandoffStateDocumentV2Schema as ZodType<HandoffStateDocument> },
];

export function toHandoffStateDocument(
  active: ProfileHandoffState | null,
  history: readonly ProfileHandoffState[] = [],
): HandoffStateDocument {
  return {
    schemaVersion: CURRENT_HANDOFF_STATE_SCHEMA_VERSION,
    active,
    ...(history.length > 0 ? { history: [...history] } : {}),
  };
}
