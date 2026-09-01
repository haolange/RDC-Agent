import { generateShortId } from '@shared/utils/id';
import type { KnowledgeCardRecord, SessionKnowledgeCandidate } from '@shared/types/knowledge';
import { ingestColdData, type ColdDataIngestResult } from './coldDataIngest';
import { KnowledgeCandidateRequiresIntentError } from './knowledgeErrors';

export type { SessionKnowledgeCandidate };

export interface KnowledgeCandidateCreateInput {
  sessionId: string;
  card: KnowledgeCardRecord;
  explicitUserIntent: boolean;
}

export interface KnowledgeCandidateDependencies {
  now(): Date;
  createId(): string;
}

export class KnowledgeCandidateService {
  private readonly candidates = new Map<string, SessionKnowledgeCandidate[]>();
  private readonly stagedDrafts = new Map<string, KnowledgeCardRecord[]>();

  constructor(private readonly overrides: Partial<KnowledgeCandidateDependencies> = {}) {}

  createCandidate(input: KnowledgeCandidateCreateInput): SessionKnowledgeCandidate {
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
    const existing = this.candidates.get(input.sessionId) ?? [];
    existing.push(candidate);
    this.candidates.set(input.sessionId, existing);
    return candidate;
  }

  listCandidates(sessionId: string): SessionKnowledgeCandidate[] {
    return [...(this.candidates.get(sessionId) ?? [])];
  }

  /**
   * ColdData enters session staging as Draft. This method never creates a Candidate.
   */
  ingestColdDataToStaging(source: string, options: {
    sessionId: string;
    spaceId?: string;
    availableAssetNames?: Iterable<string>;
  }): ColdDataIngestResult {
    const existingCaseIds = this.listStagedDrafts(options.sessionId)
      .map((entry) => entry.caseId)
      .filter((value): value is string => Boolean(value));
    const result = ingestColdData(source, {
      spaceId: options.spaceId ?? `staging:${options.sessionId}`,
      sessionId: options.sessionId,
      existingCaseIds,
      availableAssetNames: options.availableAssetNames,
    });
    if (result.status === 'draft' && result.record) {
      const staged = this.stagedDrafts.get(options.sessionId) ?? [];
      staged.push(result.record);
      this.stagedDrafts.set(options.sessionId, staged);
    }
    return result;
  }

  listStagedDrafts(sessionId: string): KnowledgeCardRecord[] {
    return [...(this.stagedDrafts.get(sessionId) ?? [])];
  }
}

export const knowledgeCandidateService = new KnowledgeCandidateService();
