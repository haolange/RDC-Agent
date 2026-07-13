import type { CatalogLayerContribution, CatalogModelContribution } from './EffectiveCatalogService';
import { normalizeDiscoveredModelMatchKey } from './DiscoveryAdmission';

const MISSING_DISCOVERY_REASON = 'This model was not returned by the latest successful provider discovery.';

function fastVariantBaseId(modelId: string): string | null {
  return /-fast$/iu.test(modelId) ? modelId.replace(/-fast$/iu, '') : null;
}

export function normalizeCopilotDiscoveryModels(
  models: CatalogModelContribution[],
): CatalogModelContribution[] {
  const liveModels = models.filter((model) => model.availability !== 'unavailable');
  const liveByKey = new Map(liveModels.map((model) => [
    normalizeDiscoveredModelMatchKey(model.modelId),
    model,
  ]));
  const fastVariantByBaseKey = new Map<string, CatalogModelContribution>();
  for (const model of liveModels) {
    const baseId = fastVariantBaseId(model.modelId);
    if (!baseId) continue;
    const baseKey = normalizeDiscoveredModelMatchKey(baseId);
    if (liveByKey.has(baseKey)) fastVariantByBaseKey.set(baseKey, model);
  }

  return models.flatMap((model) => {
    const key = normalizeDiscoveredModelMatchKey(model.modelId);
    if (
      model.availability === 'unavailable'
      && model.unavailableReason === MISSING_DISCOVERY_REASON
      && liveByKey.has(key)
    ) {
      return [];
    }
    const baseId = fastVariantBaseId(model.modelId);
    if (baseId && liveByKey.has(normalizeDiscoveredModelMatchKey(baseId))) {
      return [];
    }
    if (model.availability === 'unavailable' || model.fast) return [model];
    const fastVariant = fastVariantByBaseKey.get(key);
    return [{
      ...model,
      fast: fastVariant
        ? { kind: 'model-variant', modelId: fastVariant.modelId, entitlement: 'granted' }
        : { kind: 'unsupported' },
    }];
  });
}

export function normalizeProviderDiscoveryLayer(
  providerId: string,
  layer: CatalogLayerContribution,
): CatalogLayerContribution {
  if (providerId !== 'github-copilot') return layer;
  return { ...layer, models: normalizeCopilotDiscoveryModels(layer.models) };
}
