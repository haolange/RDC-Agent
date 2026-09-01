import type { ProviderSurfaceManifest } from './catalogManifestSchema';
import {
  embeddingAdapterSupportsProtocol,
  getEmbeddingAdapterImplementation,
} from './embeddingImplementationRegistry';
import {
  EMBEDDING_CATALOG_SCHEMA_VERSION,
  type EmbeddingCatalog,
  type EmbeddingCatalogModel,
} from '../types/embedding';

export function compileEmbeddingCatalog(
  surfaces: ProviderSurfaceManifest[],
  catalogRevision: string,
): EmbeddingCatalog {
  const models: EmbeddingCatalogModel[] = [];
  for (const surface of surfaces) {
    const embeddings = surface.embeddings;
    if (!embeddings) continue;
    for (const model of embeddings.models) {
      models.push({
        providerId: surface.id,
        modelId: model.modelId,
        label: model.label,
        dimensions: model.dimensions,
        ...(model.maxInputTokens !== undefined ? { maxInputTokens: model.maxInputTokens } : {}),
        protocol: embeddings.protocol,
        adapterId: embeddings.adapterId,
        baseUrl: embeddings.baseUrl,
        factSourceId: model.factSourceId,
      });
    }
  }
  models.sort((left, right) => (
    left.providerId.localeCompare(right.providerId) || left.modelId.localeCompare(right.modelId)
  ));
  return {
    schemaVersion: EMBEDDING_CATALOG_SCHEMA_VERSION,
    catalogRevision,
    models,
  };
}

export function validateSurfaceEmbeddings(
  surface: ProviderSurfaceManifest,
  factSourceIds: Set<string>,
  errors: string[],
): void {
  const embeddings = surface.embeddings;
  if (!embeddings) return;

  if (!embeddings.baseUrl.trim()) {
    errors.push(`${surface.id} embeddings baseUrl is empty`);
  }
  if (!getEmbeddingAdapterImplementation(embeddings.adapterId)) {
    errors.push(`${surface.id} embeddings adapter ${embeddings.adapterId} is not registered`);
  } else if (!embeddingAdapterSupportsProtocol(embeddings.adapterId, embeddings.protocol)) {
    errors.push(
      `${surface.id} embeddings adapter ${embeddings.adapterId} does not implement ${embeddings.protocol}`,
    );
  }

  const agentModelIds = new Set(surface.models.flatMap((model) => [model.modelId, ...model.aliases]));
  const embeddingIds = new Set<string>();
  for (const model of embeddings.models) {
    if (embeddingIds.has(model.modelId)) {
      errors.push(`${surface.id} embeddings has duplicate model ${model.modelId}`);
    }
    embeddingIds.add(model.modelId);
    if (agentModelIds.has(model.modelId)) {
      errors.push(`${surface.id} embeddings model ${model.modelId} must not also appear in Agent models`);
    }
    if (!factSourceIds.has(model.factSourceId)) {
      errors.push(`${surface.id} embeddings model ${model.modelId} has unknown fact source ${model.factSourceId}`);
    }
  }
}

export function embeddingCatalogIdentities(catalog: EmbeddingCatalog): Set<string> {
  return new Set(catalog.models.map((model) => `${model.providerId}:${model.modelId}`));
}
