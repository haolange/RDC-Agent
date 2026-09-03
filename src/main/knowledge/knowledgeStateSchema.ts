import { z, type ZodType } from 'zod';
import type { KnowledgeCardRecord, KnowledgeReviewRecord, SessionKnowledgeCandidate } from '@shared/types/knowledge';
import type { StorageMigration } from '../sessions/storageSchema';
import { KnowledgeCardRecordSchema } from './knowledgeCardSchema';

export const KNOWLEDGE_STATE_SCHEMA_VERSION = '1';
export const KNOWLEDGE_STATE_FILE = 'knowledge-state.json';
export const KNOWLEDGE_STATE_LOCK_FILE = '.knowledge-state.lock';
export const KNOWLEDGE_STATE_LOCK_TIMEOUT = 'KNOWLEDGE_STATE_LOCK_TIMEOUT';

const hex64 = z.string().regex(/^[a-f0-9]{64}$/);

export const KnowledgeDurableDraftSchema = z.object({
  revision: z.number().int().positive(),
  contentHash: hex64,
  card: KnowledgeCardRecordSchema,
  sourceHash: hex64.optional(),
  sourceMtimeMs: z.number().int().nonnegative().optional(),
  sourceSize: z.number().int().nonnegative().optional(),
}).strict();

export const KnowledgeDurableCandidateSchema = z.object({
  revision: z.number().int().positive(),
  contentHash: hex64,
  candidate: z.object({
    candidateId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    card: KnowledgeCardRecordSchema,
    createdAt: z.string().trim().min(1),
    source: z.literal('explicit-user-intent'),
  }).strict(),
}).strict();

export const KnowledgeDurableReviewSchema = z.object({
  revision: z.number().int().positive(),
  contentHash: hex64,
  review: z.object({
    reviewId: z.string().trim().min(1),
    sessionId: z.string().trim().min(1),
    kind: z.enum(['write', 'promote']),
    cardId: z.string().trim().min(1),
    createdAt: z.string().trim().min(1),
    revision: z.number().int().positive(),
    contentHash: hex64,
  }).strict(),
}).strict();

export const KnowledgeStateDocumentSchema = z.object({
  schemaVersion: z.literal(KNOWLEDGE_STATE_SCHEMA_VERSION),
  drafts: z.array(KnowledgeDurableDraftSchema),
  candidates: z.array(KnowledgeDurableCandidateSchema),
  reviews: z.array(KnowledgeDurableReviewSchema),
}).strict();

export interface KnowledgeDurableDraft {
  revision: number;
  contentHash: string;
  card: KnowledgeCardRecord;
  sourceHash?: string;
  sourceMtimeMs?: number;
  sourceSize?: number;
}

export interface KnowledgeDurableCandidate {
  revision: number;
  contentHash: string;
  candidate: SessionKnowledgeCandidate;
}

export interface KnowledgeDurableReview {
  revision: number;
  contentHash: string;
  review: KnowledgeReviewRecord;
}

export interface KnowledgeStateDocument {
  schemaVersion: typeof KNOWLEDGE_STATE_SCHEMA_VERSION;
  drafts: KnowledgeDurableDraft[];
  candidates: KnowledgeDurableCandidate[];
  reviews: KnowledgeDurableReview[];
}

export const KNOWLEDGE_STATE_MIGRATIONS: StorageMigration<KnowledgeStateDocument>[] = [
  {
    schemaVersion: KNOWLEDGE_STATE_SCHEMA_VERSION,
    schema: KnowledgeStateDocumentSchema as ZodType<KnowledgeStateDocument>,
  },
];

export function emptyKnowledgeStateDocument(): KnowledgeStateDocument {
  return {
    schemaVersion: KNOWLEDGE_STATE_SCHEMA_VERSION,
    drafts: [],
    candidates: [],
    reviews: [],
  };
}
