import { generateShortId } from '@shared/utils/id';
import type {
  KnowledgeCardRecord,
  KnowledgeReviewRecord,
  SessionKnowledgeCandidate,
} from '@shared/types/knowledge';
import { KnowledgeCandidateRequiresIntentError } from './knowledgeErrors';
import {
  createSessionScopedKnowledgeStore,
  knowledgeDurableStore,
  type KnowledgeDurableStore,
} from './KnowledgeDurableStore';

export type { SessionKnowledgeCandidate };

export interface KnowledgeCandidateCreateInput {
  sessionId: string;
  card: KnowledgeCardRecord;
  explicitUserIntent: boolean;
}

export interface KnowledgeReviewQueueInput {
  sessionId: string;
  kind: KnowledgeReviewRecord['kind'];
  cardId: string;
}

export interface KnowledgeCandidateDependencies {
  now(): Date;
  createId(): string;
  store: KnowledgeDurableStore;
}

export class KnowledgeCandidateService {
  constructor(private readonly overrides: Partial<KnowledgeCandidateDependencies> = {}) {}

  private get store(): KnowledgeDurableStore {
    return this.overrides.store ?? knowledgeDurableStore;
  }

  async createCandidate(input: KnowledgeCandidateCreateInput): Promise<SessionKnowledgeCandidate> {
    if (input.explicitUserIntent !== true) {
      throw new KnowledgeCandidateRequiresIntentError();
    }
    const candidate: SessionKnowledgeCandidate = {
      candidateId: `cand_${(this.overrides.createId ?? generateShortId)()}`,
      sessionId: input.sessionId,
      card: {
        ...input.card,
        lifecycle: 'candidate',
      },
      createdAt: (this.overrides.now ?? (() => new Date()))().toISOString(),
      source: 'explicit-user-intent',
    };
    await this.store.putCandidate(input.sessionId, { candidate });
    return candidate;
  }

  async listCandidates(sessionId: string): Promise<SessionKnowledgeCandidate[]> {
    return (await this.store.listCandidates(sessionId)).map((entry) => entry.candidate);
  }

  async queueReview(input: KnowledgeReviewQueueInput): Promise<KnowledgeReviewRecord> {
    const stored = await this.store.putReview(input.sessionId, {
      review: {
        reviewId: `rev_${(this.overrides.createId ?? generateShortId)()}`,
        sessionId: input.sessionId,
        kind: input.kind,
        cardId: input.cardId,
        createdAt: (this.overrides.now ?? (() => new Date()))().toISOString(),
      },
    });
    return stored.review;
  }

  async listReviews(sessionId: string): Promise<KnowledgeReviewRecord[]> {
    return (await this.store.listReviews(sessionId)).map((entry) => entry.review);
  }
}

export function createDisposableCandidateService(
  rootPath: string,
  overrides: Partial<Omit<KnowledgeCandidateDependencies, 'store'>> = {},
): KnowledgeCandidateService {
  return new KnowledgeCandidateService({
    ...overrides,
    store: createSessionScopedKnowledgeStore(rootPath),
  });
}

export const knowledgeCandidateService = new KnowledgeCandidateService();
