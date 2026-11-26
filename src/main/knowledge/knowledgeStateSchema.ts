import { z } from 'zod';
import { KnowledgeCardRecordSchema } from './knowledgeCardSchema';
import type { KnowledgeCardRecord, SessionKnowledgeCandidate } from '@shared/types/knowledge';

export const KNOWLEDGE_STATE_FILE = 'knowledge-state.json';
export const KNOWLEDGE_STATE_LOCK_FILE = '.knowledge-state.lock';
export const KNOWLEDGE_STATE_LOCK_TIMEOUT = 'KNOWLEDGE_STATE_LOCK_TIMEOUT';

const hex64 = z.string().regex(/^[a-f0-9]{64}$/);

export const KnowledgeDurableDraftSchema = z
  .object({
    revision: z.number().int().positive(),
    contentHash: hex64,
    card: KnowledgeCardRecordSchema,
    sourceHash: hex64.optional(),
    sourceMtimeMs: z.number().int().nonnegative().optional(),
    sourceSize: z.number().int().nonnegative().optional(),
  })
  .strict();

export const KnowledgeDurableCandidateSchema = z
  .object({
    revision: z.number().int().positive(),
    contentHash: hex64,
    candidate: z
      .object({
        candidateId: z.string().trim().min(1),
        sessionId: z.string().trim().min(1),
        card: KnowledgeCardRecordSchema,
        createdAt: z.string().trim().min(1),
        source: z.literal('explicit-user-intent'),
      })
      .strict(),
  })
  .strict();

export const KnowledgeDurableReviewSchema = z
  .object({
    revision: z.number().int().positive(),
    contentHash: hex64,
    review: z
      .object({
        reviewId: z.string().trim().min(1),
        sessionId: z.string().trim().min(1),
        kind: z.enum(['write', 'promote']),
        cardId: z.string().trim().min(1),
        createdAt: z.string().trim().min(1),
        revision: z.number().int().positive(),
        contentHash: hex64,
      })
      .strict(),
  })
  .strict();

export const KnowledgeStateDocumentSchema = z
  .object({
    candidates: z.array(KnowledgeDurableCandidateSchema),
    reviews: z.array(KnowledgeDurableReviewSchema),
    drafts: z.array(KnowledgeDurableDraftSchema).optional(),
  })
  .strict();

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
  candidates: KnowledgeDurableCandidate[];
  reviews: KnowledgeDurableReview[];
}

export function emptyKnowledgeStateDocument(): KnowledgeStateDocument {
  return {
    candidates: [],
    reviews: [],
  };
}

export function parseKnowledgeStatePayload(raw: unknown): {
  document: KnowledgeStateDocument;
  leftoverDrafts: KnowledgeDurableDraft[];
} {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { document: emptyKnowledgeStateDocument(), leftoverDrafts: [] };
  }
  const parsed = KnowledgeStateDocumentSchema.parse(raw);
  return {
    document: {
      candidates: parsed.candidates,
      reviews: parsed.reviews,
    },
    leftoverDrafts: parsed.drafts ?? [],
  };
}

export function serializeKnowledgeStateDocument(
  document: KnowledgeStateDocument,
  leftoverDrafts: readonly KnowledgeDurableDraft[],
): string {
  const payload =
    leftoverDrafts.length > 0
      ? {
          candidates: document.candidates,
          reviews: document.reviews,
          drafts: [...leftoverDrafts],
        }
      : {
          candidates: document.candidates,
          reviews: document.reviews,
        };
  return `${JSON.stringify(payload, null, 2)}\n`;
}

export interface KnowledgeReviewRecord {
  reviewId: string;
  sessionId: string;
  kind: 'write' | 'promote';
  cardId: string;
  createdAt: string;
  revision: number;
  contentHash: string;
}
