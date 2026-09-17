import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  KnowledgeReviewRecord,
  SessionKnowledgeCandidate,
} from '@shared/types/knowledge';
import { storageAdapter } from '../sessions/StorageAdapter';
import { StorageIo } from '../sessions/StorageIo';
import { assertNoUnsupportedSchemaVersion } from '../sessions/storageSchema';
import { withDirectoryFileLock } from '../sessions/directoryFileLock';
import { KnowledgeRevisionConflictError } from './knowledgeErrors';
import {
  emptyKnowledgeStateDocument,
  KNOWLEDGE_STATE_FILE,
  KNOWLEDGE_STATE_LOCK_FILE,
  KNOWLEDGE_STATE_LOCK_TIMEOUT,
  KNOWLEDGE_STATE_SCHEMA_VERSION,
  parseKnowledgeStatePayload,
  serializeKnowledgeStateDocument,
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

  async listCandidates(sessionId: string): Promise<KnowledgeDurableCandidate[]> {
    return [...(await this.load(sessionId)).document.candidates];
  }

  async listReviews(sessionId: string): Promise<KnowledgeDurableReview[]> {
    return [...(await this.load(sessionId)).document.reviews];
  }

  async listLeftoverDrafts(sessionId: string): Promise<KnowledgeDurableDraft[]> {
    return [...(await this.load(sessionId)).leftoverDrafts];
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

  async replaceLeftoverDrafts(sessionId: string, leftoverDrafts: readonly KnowledgeDurableDraft[]): Promise<void> {
    await this.withSessionLock(sessionId, async () => {
      const loaded = this.loadUnlocked(sessionId);
      this.writeUnlocked(sessionId, loaded.document, leftoverDrafts);
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

  private async load(sessionId: string): Promise<{
    document: KnowledgeStateDocument;
    leftoverDrafts: KnowledgeDurableDraft[];
  }> {
    try {
      return this.loadUnlocked(sessionId);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('KNOWLEDGE_SESSION_UNKNOWN')) {
        return { document: emptyKnowledgeStateDocument(), leftoverDrafts: [] };
      }
      throw error;
    }
  }

  private loadUnlocked(sessionId: string): {
    document: KnowledgeStateDocument;
    leftoverDrafts: KnowledgeDurableDraft[];
  } {
    const statePath = this.resolveStatePath(sessionId);
    const raw = this.storage.readJson<unknown>(statePath);
    if (raw == null) {
      return { document: emptyKnowledgeStateDocument(), leftoverDrafts: [] };
    }
    assertNoUnsupportedSchemaVersion(raw, KNOWLEDGE_STATE_SCHEMA_VERSION, statePath);
    return parseKnowledgeStatePayload(raw);
  }

  private writeUnlocked(
    sessionId: string,
    document: KnowledgeStateDocument,
    leftoverDrafts: readonly KnowledgeDurableDraft[],
  ): void {
    const statePath = this.resolveStatePath(sessionId);
    this.storage.ensureDir(path.dirname(statePath));
    this.storage.writeUtf8AtomicFsync(statePath, serializeKnowledgeStateDocument(document, leftoverDrafts));
    const written = this.storage.readJson<unknown>(statePath);
    if (!written) {
      throw new Error('KNOWLEDGE_WRITE_INTEGRITY: durable knowledge-state.json vanished after atomic replace.');
    }
    assertNoUnsupportedSchemaVersion(written, KNOWLEDGE_STATE_SCHEMA_VERSION, statePath);
    parseKnowledgeStatePayload(written);
  }

  private async mutate<T>(
    sessionId: string,
    mutate: (document: KnowledgeStateDocument) => T,
  ): Promise<T> {
    return this.withSessionLock(sessionId, async () => {
      const loaded = this.loadUnlocked(sessionId);
      const result = mutate(loaded.document);
      this.writeUnlocked(sessionId, loaded.document, loaded.leftoverDrafts);
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
