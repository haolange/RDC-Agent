import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  KnowledgeCardRecord,
  KnowledgeReviewRecord,
  SessionKnowledgeCandidate,
} from '@shared/types/knowledge';
import { storageAdapter } from '../sessions/StorageAdapter';
import { StorageIo } from '../sessions/StorageIo';
import { withDirectoryFileLock } from '../sessions/directoryFileLock';
import { KnowledgeRevisionConflictError } from './knowledgeErrors';
import {
  emptyKnowledgeStateDocument,
  KNOWLEDGE_STATE_FILE,
  KNOWLEDGE_STATE_LOCK_FILE,
  KNOWLEDGE_STATE_LOCK_TIMEOUT,
  KNOWLEDGE_STATE_MIGRATIONS,
  type KnowledgeDurableCandidate,
  type KnowledgeDurableDraft,
  type KnowledgeDurableReview,
  type KnowledgeStateDocument,
} from './knowledgeStateSchema';

export interface KnowledgeDurableStoreDependencies {
  resolveStatePath(sessionId: string): string;
  storage?: StorageIo;
  lockMaxAttempts?: number;
}

export interface KnowledgePutDraftInput {
  card: KnowledgeCardRecord;
  expectedRevision?: number;
  sourceHash?: string;
  sourceMtimeMs?: number;
  sourceSize?: number;
}

export interface KnowledgePutCandidateInput {
  candidate: SessionKnowledgeCandidate;
  expectedRevision?: number;
}

export interface KnowledgePutReviewInput {
  review: Omit<KnowledgeReviewRecord, 'revision' | 'contentHash'>;
  expectedRevision?: number;
}

export function hashKnowledgeContent(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export function createSessionScopedKnowledgeStore(rootPath: string): KnowledgeDurableStore {
  return new KnowledgeDurableStore({
    resolveStatePath: (sessionId) => path.join(rootPath, sessionId, KNOWLEDGE_STATE_FILE),
  });
}

function defaultSessionStatePath(sessionId: string): string {
  const location = storageAdapter.sessions.findSessionLocation(sessionId);
  if (!location) {
    throw new Error(`KNOWLEDGE_SESSION_UNKNOWN: no durable session path for ${sessionId}.`);
  }
  return path.join(location.sessionPath, KNOWLEDGE_STATE_FILE);
}

export class KnowledgeDurableStore {
  private readonly storage: StorageIo;

  constructor(private readonly overrides: Partial<KnowledgeDurableStoreDependencies> = {}) {
    this.storage = overrides.storage ?? new StorageIo();
  }

  resolveStatePath(sessionId: string): string {
    return (this.overrides.resolveStatePath ?? defaultSessionStatePath)(sessionId);
  }

  async listDrafts(sessionId: string): Promise<KnowledgeDurableDraft[]> {
    return [...(await this.readDocument(sessionId)).drafts];
  }

  async listCandidates(sessionId: string): Promise<KnowledgeDurableCandidate[]> {
    return [...(await this.readDocument(sessionId)).candidates];
  }

  async listReviews(sessionId: string): Promise<KnowledgeDurableReview[]> {
    return [...(await this.readDocument(sessionId)).reviews];
  }

  async putDraft(sessionId: string, input: KnowledgePutDraftInput): Promise<KnowledgeDurableDraft> {
    return this.mutate(sessionId, (document) => {
      const contentHash = hashKnowledgeContent(input.card);
      const index = document.drafts.findIndex((entry) => entry.card.cardId === input.card.cardId);
      const next = upsertRecord(document.drafts[index], input.expectedRevision, contentHash, (revision) => ({
        revision,
        contentHash,
        card: input.card,
        ...(input.sourceHash ? { sourceHash: input.sourceHash } : {}),
        ...(input.sourceMtimeMs != null ? { sourceMtimeMs: input.sourceMtimeMs } : {}),
        ...(input.sourceSize != null ? { sourceSize: input.sourceSize } : {}),
      }), `draft ${input.card.cardId}`);
      if (index >= 0) document.drafts[index] = next;
      else document.drafts.push(next);
      return next;
    });
  }

  async putCandidate(sessionId: string, input: KnowledgePutCandidateInput): Promise<KnowledgeDurableCandidate> {
    return this.mutate(sessionId, (document) => {
      const contentHash = hashKnowledgeContent(input.candidate);
      const index = document.candidates.findIndex(
        (entry) => entry.candidate.candidateId === input.candidate.candidateId,
      );
      const next = upsertRecord(document.candidates[index], input.expectedRevision, contentHash, (revision) => ({
        revision,
        contentHash,
        candidate: input.candidate,
      }), `candidate ${input.candidate.candidateId}`);
      if (index >= 0) document.candidates[index] = next;
      else document.candidates.push(next);
      return next;
    });
  }

  async putReview(sessionId: string, input: KnowledgePutReviewInput): Promise<KnowledgeDurableReview> {
    return this.mutate(sessionId, (document) => {
      const contentHash = hashKnowledgeContent({
        reviewId: input.review.reviewId,
        kind: input.review.kind,
        cardId: input.review.cardId,
      });
      const index = document.reviews.findIndex((entry) => entry.review.reviewId === input.review.reviewId);
      const next = upsertRecord(document.reviews[index], input.expectedRevision, contentHash, (revision) => ({
        revision,
        contentHash,
        review: {
          ...input.review,
          revision,
          contentHash,
        },
      }), `review ${input.review.reviewId}`);
      if (index >= 0) document.reviews[index] = next;
      else document.reviews.push(next);
      return next;
    });
  }

  async withSessionLock<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const statePath = this.resolveStatePath(sessionId);
    return withDirectoryFileLock(path.dirname(statePath), {
      lockFileName: KNOWLEDGE_STATE_LOCK_FILE,
      timeoutCode: KNOWLEDGE_STATE_LOCK_TIMEOUT,
      ...(this.overrides.lockMaxAttempts != null ? { maxAttempts: this.overrides.lockMaxAttempts } : {}),
    }, operation);
  }

  private async readDocument(sessionId: string): Promise<KnowledgeStateDocument> {
    try {
      const statePath = this.resolveStatePath(sessionId);
      return this.storage.readJson(statePath, KNOWLEDGE_STATE_MIGRATIONS)
        ?? emptyKnowledgeStateDocument();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('KNOWLEDGE_SESSION_UNKNOWN')) {
        return emptyKnowledgeStateDocument();
      }
      throw error;
    }
  }

  private async mutate<T>(sessionId: string, mutate: (document: KnowledgeStateDocument) => T): Promise<T> {
    return this.withSessionLock(sessionId, async () => {
      const statePath = this.resolveStatePath(sessionId);
      const document = this.storage.readJson(statePath, KNOWLEDGE_STATE_MIGRATIONS)
        ?? emptyKnowledgeStateDocument();
      const result = mutate(document);
      this.storage.ensureDir(path.dirname(statePath));
      this.storage.writeUtf8AtomicFsync(statePath, `${JSON.stringify(document, null, 2)}\n`);
      const written = this.storage.readJson(statePath, KNOWLEDGE_STATE_MIGRATIONS);
      if (!written) {
        throw new Error('KNOWLEDGE_WRITE_INTEGRITY: durable knowledge-state.json vanished after atomic replace.');
      }
      return result;
    });
  }
}

function upsertRecord<T extends { revision: number; contentHash: string }>(
  existing: T | undefined,
  expectedRevision: number | undefined,
  contentHash: string,
  build: (revision: number) => T,
  label: string,
): T {
  if (!existing) {
    if (expectedRevision != null && expectedRevision !== 0) {
      throw new KnowledgeRevisionConflictError(`${label} does not exist (expected revision ${expectedRevision}).`);
    }
    return build(1);
  }
  if (expectedRevision == null || expectedRevision !== existing.revision) {
    throw new KnowledgeRevisionConflictError(
      `${label} revision ${existing.revision} does not match expected ${expectedRevision ?? 'none'}; refusing overwrite.`,
    );
  }
  if (existing.contentHash === contentHash && expectedRevision === existing.revision) {
    return existing;
  }
  return build(existing.revision + 1);
}

export const knowledgeDurableStore = new KnowledgeDurableStore();
