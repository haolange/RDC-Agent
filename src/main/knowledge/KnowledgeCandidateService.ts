import { generateShortId } from '@shared/utils/id';
import type {
  KnowledgeCardRecord,
  KnowledgeReviewRecord,
  SessionKnowledgeCandidate,
} from '@shared/types/knowledge';
import { ingestKnowledge, ingestKnowledgeFromPath, type KnowledgeImportResult } from './knowledgeIngest';
import { putStagedKnowledgeImages } from './knowledgeImageStaging';
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

  /**
   * Imported knowledge enters session staging as Draft. This method never creates a Candidate.
   */
  async ingestToStaging(source: string, options: {
    sessionId: string;
    spaceId?: string;
    availableAssetNames?: Iterable<string>;
    availableImagePaths?: Iterable<string>;
  }): Promise<KnowledgeImportResult> {
    const existing = await this.existingImportIds(options.sessionId);
    const result = ingestKnowledge(source, {
      spaceId: options.spaceId ?? `staging:${options.sessionId}`,
      sessionId: options.sessionId,
      ...existing,
      availableAssetNames: options.availableAssetNames,
      availableImagePaths: options.availableImagePaths,
    });
    return this.persistDraftResult(options.sessionId, result);
  }

  async ingestPathToStaging(filePath: string, options: {
    sessionId: string;
    spaceId?: string;
    availableAssetNames?: Iterable<string>;
    availableImagePaths?: Iterable<string>;
  }): Promise<KnowledgeImportResult> {
    const existing = await this.existingImportIds(options.sessionId);
    const result = await ingestKnowledgeFromPath(filePath, {
      spaceId: options.spaceId ?? `staging:${options.sessionId}`,
      sessionId: options.sessionId,
      ...existing,
      availableAssetNames: options.availableAssetNames,
      availableImagePaths: options.availableImagePaths,
    });
    return this.persistDraftResult(options.sessionId, result);
  }

  async listStagedDrafts(sessionId: string): Promise<KnowledgeCardRecord[]> {
    return (await this.store.listDrafts(sessionId)).map((entry) => {
      const card = { ...entry.card };
      if (entry.sourceHash) card.sourceHash = entry.sourceHash;
      if (entry.sourceMtimeMs != null) card.sourceMtimeMs = entry.sourceMtimeMs;
      if (entry.sourceSize != null) card.sourceSize = entry.sourceSize;
      return card;
    });
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

  private async existingImportIds(sessionId: string): Promise<{
    existingCaseIds: string[];
    existingCardIds: string[];
  }> {
    const drafts = await this.listStagedDrafts(sessionId);
    return {
      existingCaseIds: drafts.map((entry) => entry.caseId).filter((value): value is string => Boolean(value)),
      existingCardIds: drafts.map((entry) => entry.cardId),
    };
  }

  private async persistDraftResult(
    sessionId: string,
    result: import('./knowledgeIngest').KnowledgeImportPathResult,
  ): Promise<KnowledgeImportResult> {
    for (const item of result.items) {
      if (item.status !== 'draft' || !item.record) continue;
      await this.store.putDraft(sessionId, {
        card: item.record,
        ...(result.sourceHash ? { sourceHash: result.sourceHash } : {}),
        ...(result.sourceMtimeMs != null ? { sourceMtimeMs: result.sourceMtimeMs } : {}),
        ...(result.sourceSize != null ? { sourceSize: result.sourceSize } : {}),
      });
      const staged = result.stagedImagesByCardId?.get(item.record.cardId);
      if (staged?.length) {
        await putStagedKnowledgeImages(item.record.cardId, staged);
      }
    }
    const { stagedImagesByCardId: _staged, ...publicResult } = result;
    return publicResult;
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
