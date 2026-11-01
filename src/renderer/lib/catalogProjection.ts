import type { EffectiveCatalogSnapshot } from '@shared/types/providerCapability';

/** Timestamps are audit metadata; a configuration generation owns its ordering. */
export function latestCatalogProjection(
  current: EffectiveCatalogSnapshot | null,
  incoming: EffectiveCatalogSnapshot,
): EffectiveCatalogSnapshot {
  return current?.scopeGeneration === incoming.scopeGeneration && current.projectionVersion >= incoming.projectionVersion
    ? current : incoming;
}
