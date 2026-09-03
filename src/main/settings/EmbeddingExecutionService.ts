import path from 'node:path';
import {
  embeddingIdentity,
  sanitizeEmbeddingSettings,
  SEMANTIC_INDEX_SNAPSHOT_SCHEMA_VERSION,
  type EmbeddingBatchResult,
  type EmbeddingCatalog,
  type EmbeddingCatalogModel,
  type EmbeddingSettings,
  type EmbeddingVector,
  type SemanticIndexSnapshot,
  type SemanticLaneStatus,
  type SemanticSearchHit,
} from '@shared/types/embedding';
import { getEmbeddingCatalog } from '../provider-catalog/ProviderCatalogRegistry';
import { knowledgeCorpusHash, type SemanticCorpusDocument } from '../knowledge/knowledgeLanes';
import {
  compareSemanticHits,
  cosineSimilarity,
  draftSemanticChunks,
  SEMANTIC_CHUNKER_ID,
} from '../knowledge/semanticChunker';
import {
  assertValidEmbeddingBatch,
  EmbeddingIndexValidationError,
  inspectSemanticIndexVectors,
  parseSemanticIndexSnapshot,
} from '../knowledge/semanticIndexSchema';
import { knowledgeIndexService } from '../knowledge/KnowledgeIndexService';
import { appPathService } from '../runtime/AppPathService';
import { StorageIo } from '../sessions/StorageIo';
import {
  freezeProviderRuntimeCredentials,
  releaseProviderRuntimeCredentials,
} from './ProviderRuntimeCredentialLease';
import { providerRuntimeCredentialService } from './ProviderRuntimeCredentialService';
import { settingsService } from './SettingsService';

const SNAPSHOT_FILE = 'semantic-index.json';
const DEFAULT_BATCH_SIZE = 64;

export class EmbeddingConsentDeniedError extends Error {
  readonly code = 'EMBEDDING_CONSENT_DENIED';
  constructor() {
    super('EMBEDDING_CONSENT_DENIED: Knowledge upload consent is off; semantic lane is unavailable.');
    this.name = 'EmbeddingConsentDeniedError';
  }
}

export class EmbeddingUnconfiguredError extends Error {
  readonly code = 'EMBEDDING_UNCONFIGURED';
  constructor(message = 'EMBEDDING_UNCONFIGURED: No embedding model is selected.') {
    super(message);
    this.name = 'EmbeddingUnconfiguredError';
  }
}

export { EmbeddingIndexValidationError };

export interface EmbeddingExecutionDependencies {
  getCatalog(): EmbeddingCatalog;
  getSettings(): EmbeddingSettings;
  isProviderConfigured(providerId: string): boolean;
  snapshotPath(): string;
  storage: StorageIo;
  freeze(providerId: string): Promise<{ handle: string }>;
  release(handle: string | undefined): void;
  readLease(handle: string, providerId: string): { provider: { apiKey: string }; connectionHeaders: Readonly<Record<string, string>> };
  fetch: typeof fetch;
  now(): Date;
  batchSize: number;
  interBatchDelayMs: number;
  sleep(ms: number): Promise<void>;
  listCorpusDocuments(): Promise<SemanticCorpusDocument[]>;
  getCorpusHash(): Promise<string>;
  embedTexts?: (input: { texts: string[]; model: EmbeddingCatalogModel }) => Promise<EmbeddingBatchResult>;
}

const defaultDependencies = (): EmbeddingExecutionDependencies => ({
  getCatalog: getEmbeddingCatalog,
  getSettings: () => sanitizeEmbeddingSettings(settingsService.getAll().llm.embedding),
  isProviderConfigured: (providerId) => {
    const provider = settingsService.getAll().llm.providers.find((entry) => entry.id === providerId);
    return Boolean(provider?.isConfigured && provider.enabled);
  },
  snapshotPath: () => path.join(appPathService.getRuntimePaths().knowledgePath, SNAPSHOT_FILE),
  storage: new StorageIo(),
  freeze: (providerId) => freezeProviderRuntimeCredentials(providerId, 'embed'),
  release: releaseProviderRuntimeCredentials,
  readLease: (handle, providerId) => {
    const lease = providerRuntimeCredentialService.get(handle, providerId, 'embed');
    if (!lease) throw new Error(`Runtime credential handle is invalid for ${providerId}.`);
    return lease;
  },
  fetch,
  now: () => new Date(),
  batchSize: DEFAULT_BATCH_SIZE,
  interBatchDelayMs: 50,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  listCorpusDocuments: async () => knowledgeIndexService.listCorpusDocuments(),
  getCorpusHash: async () => knowledgeIndexService.computeLiveRevision(),
});

function resolveSelectedModel(
  catalog: EmbeddingCatalog,
  settings: EmbeddingSettings,
): EmbeddingCatalogModel | null {
  if (!settings.providerId || !settings.modelId) return null;
  return catalog.models.find((model) => (
    model.providerId === settings.providerId && model.modelId === settings.modelId
  )) ?? null;
}

function embeddingsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/u, '')}/embeddings`;
}

export class EmbeddingExecutionService {
  private readonly dependencies: EmbeddingExecutionDependencies;

  constructor(dependencies: Partial<EmbeddingExecutionDependencies> = {}) {
    this.dependencies = { ...defaultDependencies(), ...dependencies };
  }

  async resolveSemanticLaneStatus(): Promise<SemanticLaneStatus> {
    const settings = this.dependencies.getSettings();
    const catalog = this.dependencies.getCatalog();
    const selected = resolveSelectedModel(catalog, settings);
    const selectedIdentity = selected
      ? embeddingIdentity(selected.providerId, selected.modelId)
      : null;
    const selectedDimensions = selected?.dimensions ?? null;
    const snapshot = this.readSnapshot();

    if (!settings.providerId || !settings.modelId) {
      return this.status('unavailable', 'unconfigured', selectedIdentity, selectedDimensions, snapshot);
    }
    if (!selected) {
      return this.status('unavailable', 'model-unknown', selectedIdentity, selectedDimensions, snapshot);
    }
    if (!settings.allowKnowledgeUpload) {
      return this.status('unavailable', 'consent-denied', selectedIdentity, selectedDimensions, snapshot);
    }
    if (!this.dependencies.isProviderConfigured(selected.providerId)) {
      return this.status('unavailable', 'provider-unconfigured', selectedIdentity, selectedDimensions, snapshot);
    }
    if (!snapshot) {
      const raw = this.readRawSnapshot();
      return this.status(
        'stale',
        raw == null ? 'missing-snapshot' : 'invalid-vectors',
        selectedIdentity,
        selectedDimensions,
        null,
      );
    }
    if (snapshot.identity !== selectedIdentity) {
      return this.status('stale', 'identity-mismatch', selectedIdentity, selectedDimensions, snapshot);
    }
    if (snapshot.dimensions !== selected.dimensions) {
      return this.status('stale', 'dimension-mismatch', selectedIdentity, selectedDimensions, snapshot);
    }
    if (snapshot.chunker !== SEMANTIC_CHUNKER_ID) {
      return this.status('stale', 'chunker-mismatch', selectedIdentity, selectedDimensions, snapshot);
    }
    if (snapshot.catalogRevision !== catalog.catalogRevision) {
      return this.status('stale', 'catalog-revision-mismatch', selectedIdentity, selectedDimensions, snapshot);
    }
    if (snapshot.corpusHash !== await this.dependencies.getCorpusHash()) {
      return this.status('stale', 'corpus-hash-mismatch', selectedIdentity, selectedDimensions, snapshot);
    }
    const integrity = inspectSemanticIndexVectors(snapshot, selected.dimensions);
    if (integrity) {
      return this.status('stale', integrity, selectedIdentity, selectedDimensions, snapshot);
    }
    return this.status('ready', 'ready', selectedIdentity, selectedDimensions, snapshot);
  }

  async embed(texts: string[]): Promise<EmbeddingBatchResult> {
    const selected = this.requireExecutableModel();
    if (texts.length === 0) {
      return { modelId: selected.modelId, dimensions: selected.dimensions, vectors: [] };
    }
    if (this.dependencies.embedTexts) {
      const result = await this.dependencies.embedTexts({ texts, model: selected });
      assertValidEmbeddingBatch(texts, result, selected.dimensions);
      return { modelId: selected.modelId, dimensions: selected.dimensions, vectors: alignVectors(result) };
    }
    const lease = await this.dependencies.freeze(selected.providerId);
    try {
      const credential = this.dependencies.readLease(lease.handle, selected.providerId);
      const batches = this.chunk(texts, this.dependencies.batchSize);
      const vectors: EmbeddingVector[] = [];
      for (let index = 0; index < batches.length; index += 1) {
        if (index > 0 && this.dependencies.interBatchDelayMs > 0) {
          await this.dependencies.sleep(this.dependencies.interBatchDelayMs);
        }
        const batch = batches[index];
        const offset = index * this.dependencies.batchSize;
        const result = await this.requestEmbeddings(selected, credential, batch, offset);
        assertValidEmbeddingBatch(batch, {
          ...result,
          vectors: result.vectors.map((row, rowIndex) => ({
            index: rowIndex,
            embedding: row.embedding,
          })),
        }, selected.dimensions);
        vectors.push(...result.vectors);
      }
      const assembled = { modelId: selected.modelId, dimensions: selected.dimensions, vectors };
      assertValidEmbeddingBatch(texts, assembled, selected.dimensions);
      return assembled;
    } finally {
      this.dependencies.release(lease.handle);
    }
  }

  async rebuildSemanticIndex(): Promise<SemanticLaneStatus> {
    const selected = this.requireExecutableModel();
    const documents = await this.dependencies.listCorpusDocuments();
    const drafts = draftSemanticChunks(documents);
    const texts = drafts.map((draft) => draft.text);
    const embedded = await this.embed(texts);
    assertValidEmbeddingBatch(texts, embedded, selected.dimensions);
    const vectors = alignVectors(embedded).map((row) => row.embedding);
    const snapshot: SemanticIndexSnapshot = {
      schemaVersion: SEMANTIC_INDEX_SNAPSHOT_SCHEMA_VERSION,
      identity: embeddingIdentity(selected.providerId, selected.modelId),
      dimensions: selected.dimensions,
      chunker: SEMANTIC_CHUNKER_ID,
      corpusHash: knowledgeCorpusHash(documents),
      catalogRevision: this.dependencies.getCatalog().catalogRevision,
      builtAt: this.dependencies.now().toISOString(),
      chunkCount: drafts.length,
      chunks: drafts,
      vectors,
    };
    const integrity = inspectSemanticIndexVectors(snapshot, selected.dimensions);
    if (integrity) {
      throw new EmbeddingIndexValidationError(integrity);
    }
    const filePath = this.dependencies.snapshotPath();
    this.dependencies.storage.ensureDir(path.dirname(filePath));
    this.dependencies.storage.writeUtf8Atomic(filePath, JSON.stringify(snapshot), { fsync: true });
    return this.resolveSemanticLaneStatus();
  }

  async searchSemantic(queryText: string): Promise<SemanticSearchHit[]> {
    const status = await this.resolveSemanticLaneStatus();
    const snapshot = status.snapshot;
    if (status.availability !== 'ready' || !snapshot) return [];
    const text = queryText.trim();
    if (!text) return [];
    let queryVector: number[];
    try {
      const embedded = await this.embed([text]);
      queryVector = embedded.vectors[0]?.embedding ?? [];
      if (queryVector.length !== snapshot.dimensions) return [];
    } catch {
      return [];
    }
    const hits: SemanticSearchHit[] = [];
    for (let index = 0; index < snapshot.chunks.length; index += 1) {
      const chunk = snapshot.chunks[index];
      const vector = snapshot.vectors[index];
      if (!vector) continue;
      const score = cosineSimilarity(queryVector, vector);
      if (score <= 0) continue;
      hits.push({
        cardId: chunk.cardId,
        spaceId: chunk.spaceId,
        relativePath: chunk.relativePath,
        title: chunk.title,
        type: chunk.type,
        lifecycle: chunk.lifecycle,
        chunkIndex: chunk.chunkIndex,
        score,
        text: chunk.text,
      });
    }
    hits.sort(compareSemanticHits);
    return hits;
  }

  private requireExecutableModel(): EmbeddingCatalogModel {
    const settings = this.dependencies.getSettings();
    if (!settings.allowKnowledgeUpload) throw new EmbeddingConsentDeniedError();
    const selected = resolveSelectedModel(this.dependencies.getCatalog(), settings);
    if (!selected) {
      throw new EmbeddingUnconfiguredError(
        settings.providerId && settings.modelId
          ? `EMBEDDING_UNCONFIGURED: ${settings.providerId}:${settings.modelId} is not in EmbeddingCatalog.`
          : undefined,
      );
    }
    if (!this.dependencies.isProviderConfigured(selected.providerId)) {
      throw new EmbeddingUnconfiguredError(
        `EMBEDDING_UNCONFIGURED: provider ${selected.providerId} is not configured.`,
      );
    }
    return selected;
  }

  private readRawSnapshot(): unknown {
    try {
      return this.dependencies.storage.readJson<unknown>(this.dependencies.snapshotPath());
    } catch {
      return undefined;
    }
  }

  private readSnapshot(): SemanticIndexSnapshot | null {
    const raw = this.readRawSnapshot();
    if (raw == null) return null;
    return parseSemanticIndexSnapshot(raw);
  }

  private status(
    availability: SemanticLaneStatus['availability'],
    reason: SemanticLaneStatus['reason'],
    selectedIdentity: string | null,
    selectedDimensions: number | null,
    snapshot: SemanticIndexSnapshot | null,
  ): SemanticLaneStatus {
    return { availability, reason, selectedIdentity, selectedDimensions, snapshot };
  }

  private chunk(texts: string[], size: number): string[][] {
    const batches: string[][] = [];
    for (let index = 0; index < texts.length; index += size) {
      batches.push(texts.slice(index, index + size));
    }
    return batches.length > 0 ? batches : [[]];
  }

  private async requestEmbeddings(
    model: EmbeddingCatalogModel,
    credential: { provider: { apiKey: string }; connectionHeaders: Readonly<Record<string, string>> },
    input: string[],
    offset: number,
  ): Promise<EmbeddingBatchResult> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...credential.connectionHeaders,
    };
    if (credential.provider.apiKey && !headers.authorization && !headers.Authorization) {
      headers.authorization = `Bearer ${credential.provider.apiKey}`;
    }
    const response = await this.dependencies.fetch(embeddingsUrl(model.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: model.modelId, input }),
    });
    if (!response.ok) {
      throw new Error(`EMBEDDING_REQUEST_FAILED: HTTP ${response.status}`);
    }
    const payload = await response.json() as {
      data?: Array<{ index?: number; embedding?: number[] }>;
    };
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const vectors = rows.map((row, index) => ({
      index: offset + (typeof row.index === 'number' ? row.index : index),
      embedding: Array.isArray(row.embedding) ? row.embedding : [],
    }));
    return { modelId: model.modelId, dimensions: model.dimensions, vectors };
  }
}

function alignVectors(result: EmbeddingBatchResult): EmbeddingVector[] {
  return [...result.vectors]
    .sort((left, right) => left.index - right.index)
    .map((row, index) => ({ index, embedding: row.embedding }));
}

export const embeddingExecutionService = new EmbeddingExecutionService();
