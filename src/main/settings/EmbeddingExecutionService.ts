import { createHash } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';
import {
  DEFAULT_EMBEDDING_CHUNKER,
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
} from '@shared/types/embedding';
import { getEmbeddingCatalog } from '../provider-catalog/ProviderCatalogRegistry';
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
const EMPTY_CORPUS_HASH = createHash('sha256').update('', 'utf8').digest('hex');

const SemanticIndexSnapshotSchema = z.object({
  schemaVersion: z.literal(SEMANTIC_INDEX_SNAPSHOT_SCHEMA_VERSION),
  identity: z.string().min(1),
  dimensions: z.number().int().positive(),
  chunker: z.string().min(1),
  corpusHash: z.string().min(1),
  catalogRevision: z.string().min(1),
  builtAt: z.string().min(1),
}).strict();

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

  resolveSemanticLaneStatus(): SemanticLaneStatus {
    const settings = this.dependencies.getSettings();
    const selected = resolveSelectedModel(this.dependencies.getCatalog(), settings);
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
      return this.status('stale', 'missing-snapshot', selectedIdentity, selectedDimensions, snapshot);
    }
    if (snapshot.identity !== selectedIdentity) {
      return this.status('stale', 'identity-mismatch', selectedIdentity, selectedDimensions, snapshot);
    }
    if (snapshot.dimensions !== selected.dimensions) {
      return this.status('stale', 'dimension-mismatch', selectedIdentity, selectedDimensions, snapshot);
    }
    return this.status('ready', 'ready', selectedIdentity, selectedDimensions, snapshot);
  }

  async embed(texts: string[]): Promise<EmbeddingBatchResult> {
    const selected = this.requireExecutableModel();
    const lease = await this.dependencies.freeze(selected.providerId);
    try {
      const credential = this.dependencies.readLease(lease.handle, selected.providerId);
      const batches = this.chunk(texts, this.dependencies.batchSize);
      const vectors: EmbeddingVector[] = [];
      let dimensions = selected.dimensions;
      for (let index = 0; index < batches.length; index += 1) {
        if (index > 0 && this.dependencies.interBatchDelayMs > 0) {
          await this.dependencies.sleep(this.dependencies.interBatchDelayMs);
        }
        const batch = batches[index];
        const offset = index * this.dependencies.batchSize;
        const result = await this.requestEmbeddings(selected, credential, batch, offset);
        if (result.dimensions !== selected.dimensions) {
          dimensions = result.dimensions;
        }
        vectors.push(...result.vectors);
      }
      return { modelId: selected.modelId, dimensions, vectors };
    } finally {
      this.dependencies.release(lease.handle);
    }
  }

  async rebuildSemanticIndex(input: { corpusHash?: string; chunker?: string } = {}): Promise<SemanticLaneStatus> {
    const selected = this.requireExecutableModel();
    const snapshot: SemanticIndexSnapshot = {
      schemaVersion: SEMANTIC_INDEX_SNAPSHOT_SCHEMA_VERSION,
      identity: embeddingIdentity(selected.providerId, selected.modelId),
      dimensions: selected.dimensions,
      chunker: input.chunker?.trim() || DEFAULT_EMBEDDING_CHUNKER,
      corpusHash: input.corpusHash?.trim() || EMPTY_CORPUS_HASH,
      catalogRevision: this.dependencies.getCatalog().catalogRevision,
      builtAt: this.dependencies.now().toISOString(),
    };
    const filePath = this.dependencies.snapshotPath();
    this.dependencies.storage.ensureDir(path.dirname(filePath));
    this.dependencies.storage.writeJsonAtomic(filePath, snapshot);
    return this.resolveSemanticLaneStatus();
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

  private readSnapshot(): SemanticIndexSnapshot | null {
    const raw = this.dependencies.storage.readJson<unknown>(this.dependencies.snapshotPath());
    if (raw == null) return null;
    return SemanticIndexSnapshotSchema.parse(raw);
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
    const dimensions = vectors[0]?.embedding.length ?? model.dimensions;
    return { modelId: model.modelId, dimensions, vectors };
  }
}

export const embeddingExecutionService = new EmbeddingExecutionService();
