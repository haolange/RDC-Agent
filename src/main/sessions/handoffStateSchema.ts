import { z, type ZodType } from 'zod';
import type { HandoffStateDocument, ProfileHandoffState } from '@shared/types/profileHandoff';
import type { StorageMigration } from './storageSchema';

export const CURRENT_HANDOFF_STATE_SCHEMA_VERSION = '1';

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
  prompt: z.string(),
  label: z.string(),
  declaredModel: z.string().min(1).nullable(),
  send: z.boolean(),
  preparedAt: z.number(),
  committedAt: z.number().optional(),
  consumedAt: z.number().optional(),
  cancelledAt: z.number().optional(),
  cancelReason: ProfileHandoffCancelReasonSchema.optional(),
  continuationTurnId: z.string().min(1).optional(),
});

export const HandoffStateDocumentV1Schema = z.object({
  schemaVersion: z.literal('1'),
  active: ProfileHandoffStateSchema.nullable(),
  history: z.array(ProfileHandoffStateSchema).optional(),
});

export const HANDOFF_STATE_MIGRATIONS: StorageMigration<HandoffStateDocument>[] = [
  { schemaVersion: '1', schema: HandoffStateDocumentV1Schema as ZodType<HandoffStateDocument> },
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
