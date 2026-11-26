import { z } from 'zod';
import { KnowledgeCardRecordSchema } from './knowledgeCardSchema';
import type { SessionKnowledgeCandidate } from '@shared/types/knowledge';

export const KNOWLEDGE_STATE_FILE = 'knowledge-state.json';
export const KNOWLEDGE_STATE_LOCK_FILE = '.knowledge-state.lock';
export const KNOWLEDGE_STATE_LOCK_TIMEOUT = 'KNOWLEDGE_STATE_LOCK_TIMEOUT';

const hex64 = z.string().regex(/^[a-f0-9]{64}$/);

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
  })
  .strict();

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

export function serializeKnowledgeStateDocument(document: KnowledgeStateDocument): string {
  return `${JSON.stringify({ candidates: document.candidates, reviews: document.reviews }, null, 2)}\n`;
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
