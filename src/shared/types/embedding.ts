import type { EmbeddingAdapterId, EmbeddingProtocol } from '../provider-catalog/embeddingImplementationRegistry';

export const EMBEDDING_CATALOG_SCHEMA_VERSION = 1 as const;
export const SEMANTIC_INDEX_SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const DEFAULT_EMBEDDING_CHUNKER = 'plain-v1';

export interface EmbeddingCatalogModel {
  providerId: string;
  modelId: string;
  label: string;
  dimensions: number;
  maxInputTokens?: number;
  protocol: EmbeddingProtocol;
  adapterId: EmbeddingAdapterId;
  baseUrl: string;
  factSourceId: string;
}

export interface EmbeddingCatalog {
  schemaVersion: typeof EMBEDDING_CATALOG_SCHEMA_VERSION;
  catalogRevision: string;
  models: EmbeddingCatalogModel[];
}

export interface EmbeddingSettings {
  providerId: string | null;
  modelId: string | null;
  /** Explicit consent to upload User/Project Knowledge body. Default false. */
  allowKnowledgeUpload: boolean;
}

export const DEFAULT_EMBEDDING_SETTINGS: EmbeddingSettings = {
  providerId: null,
  modelId: null,
  allowKnowledgeUpload: false,
};

export type SemanticLaneAvailability = 'unavailable' | 'stale' | 'ready';

export type SemanticLaneUnavailableReason =
  | 'unconfigured'
  | 'consent-denied'
  | 'model-unknown'
  | 'provider-unconfigured';

export type SemanticLaneStaleReason =
  | 'missing-snapshot'
  | 'identity-mismatch'
  | 'dimension-mismatch'
  | 'rebuild-required';

export interface SemanticIndexSnapshot {
  schemaVersion: typeof SEMANTIC_INDEX_SNAPSHOT_SCHEMA_VERSION;
  identity: string;
  dimensions: number;
  chunker: string;
  corpusHash: string;
  catalogRevision: string;
  builtAt: string;
}

export interface SemanticLaneStatus {
  availability: SemanticLaneAvailability;
  reason: SemanticLaneUnavailableReason | SemanticLaneStaleReason | 'ready';
  selectedIdentity: string | null;
  selectedDimensions: number | null;
  snapshot: SemanticIndexSnapshot | null;
}

export interface EmbeddingVector {
  index: number;
  embedding: number[];
}

export interface EmbeddingBatchResult {
  modelId: string;
  dimensions: number;
  vectors: EmbeddingVector[];
}

export function embeddingIdentity(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

export function sanitizeEmbeddingSettings(raw: unknown): EmbeddingSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_EMBEDDING_SETTINGS };
  }
  const candidate = raw as Record<string, unknown>;
  const providerId = typeof candidate.providerId === 'string' && candidate.providerId.trim()
    ? candidate.providerId.trim()
    : null;
  const modelId = typeof candidate.modelId === 'string' && candidate.modelId.trim()
    ? candidate.modelId.trim()
    : null;
  return {
    providerId,
    modelId,
    allowKnowledgeUpload: candidate.allowKnowledgeUpload === true,
  };
}
