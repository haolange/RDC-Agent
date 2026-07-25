import {
  getProviderModelDefinitions,
  getProviderModelSummaries,
} from '../provider-catalog/ProviderCatalogRegistry';
import type { LlmProviderModel } from '@shared/types/settings';
import { extractDiscoveredModelIdentity, isAdmittedDiscoveredModel } from './DiscoveryAdmission';
import { ProviderConnectionError } from './providerConnectionErrors';

export function normalizeDiscoveredModels(
  values: unknown[],
  filterModelId: (modelId: string) => boolean = () => true,
): LlmProviderModel[] {
  const models = new Map<string, LlmProviderModel>();
  for (const value of values) {
    const identity = extractDiscoveredModelIdentity(value);
    const id = identity.id;
    if (!isAdmittedDiscoveredModel(value) || isDeprecatedModel(id) || !filterModelId(id)) {
      continue;
    }
    const label = value && typeof value === 'object' && typeof (value as { display_name?: unknown }).display_name === 'string'
      ? ((value as { display_name: string }).display_name.trim() || id)
      : id;
    const existing = models.get(id);
    const aliases = [...new Set([...(existing?.aliases ?? []), ...identity.aliases])];
    models.set(id, existing
      ? { ...existing, ...(aliases.length > 0 ? { aliases } : {}) }
      : { id, label, enabled: true, ...(aliases.length > 0 ? { aliases } : {}) });
  }
  return Array.from(models.values()).sort((left, right) => left.id.localeCompare(right.id));
}

const isDeprecatedModel = (modelId: string): boolean => {
  const normalized = modelId.toLowerCase();
  return (
    normalized.includes('deprecated')
    || normalized.startsWith('gpt-3.5')
    || normalized.startsWith('claude-2')
    || normalized.startsWith('claude-instant')
  );
};

export const requireModels = (models: LlmProviderModel[]): LlmProviderModel[] => {
  if (models.length === 0) {
    throw new ProviderConnectionError('Provider 暂未返回可用于 Agent 路由的模型');
  }
  return models;
};

export const toStaticModels = (modelIds: string[]): LlmProviderModel[] => requireModels(
  normalizeDiscoveredModels(modelIds),
);

export const requireManagedModels = (providerId: string): LlmProviderModel[] => {
  const models = getProviderModelSummaries(providerId);
  if (models.length === 0) {
    throw new ProviderConnectionError('Provider is missing an app-managed model catalog.');
  }
  return models;
};

/**
 * Volcengine Coding Plan `/models` often returns date-suffixed or vendor-prefixed ids
 * (`doubao-seed-2-0-code-preview-260215`, `volcengine/doubao-seed-2-0-pro-260215`)
 * while the product/docs use friendly ids (`doubao-seed-2.0-code`). Normalize both
 * sides for matching. Also collapses known product synonyms (mini ↔ lite).
 */
export const normalizeCodingPlanModelMatchKey = (modelId: string): string => {
  let normalized = modelId.trim().toLowerCase();
  // Strip vendor / namespace prefixes used by some clients and list payloads.
  normalized = normalized.replace(/^[^/\s]+\/+/, '');
  // Strip preview + 6–8 digit date suffixes: -260215, -preview-260215, -20260215.
  normalized = normalized.replace(/(?:-preview)?-\d{6,8}$/i, '');
  normalized = normalized.replace(/\./g, '-');
  // Product synonym: Seed 2.0 "mini" list ids map to the catalog "lite" routing id.
  if (normalized === 'doubao-seed-2-0-mini') {
    return 'doubao-seed-2-0-lite';
  }
  return normalized;
};

const isCodingPlanMetaModelId = (modelId: string): boolean => {
  const normalized = modelId.trim().toLowerCase().replace(/^[^/\s]+\/+/, '');
  return normalized === 'ark-code-latest'
    || normalized.endsWith('-latest')
    || normalized.startsWith('ark-code-');
};

const isConcreteCodingPlanDiscovery = (model: LlmProviderModel): boolean => (
  !isCodingPlanMetaModelId(model.id)
);

export const mergeManagedModelAvailability = (
  managedModels: LlmProviderModel[],
  discoveredModels: LlmProviderModel[],
  options?: {
    aliasesByModelId?: ReadonlyMap<string, readonly string[]>;
  },
): LlmProviderModel[] => {
  if (discoveredModels.length === 0) {
    return managedModels;
  }
  const discoveredKeys = new Set(
    discoveredModels.flatMap((model) => [
      model.id.toLowerCase(),
      normalizeCodingPlanModelMatchKey(model.id),
    ]),
  );
  const isDiscovered = (modelId: string, aliases?: readonly string[]): boolean => {
    const candidates = [modelId, ...(aliases ?? [])];
    return candidates.some((candidate) => (
      discoveredKeys.has(candidate.toLowerCase())
      || discoveredKeys.has(normalizeCodingPlanModelMatchKey(candidate))
    ));
  };
  const concreteDiscovery = discoveredModels.filter(isConcreteCodingPlanDiscovery);
  const metaOnlyDiscovery = concreteDiscovery.length === 0;
  const discoveredSample = discoveredModels
    .slice(0, 8)
    .map((model) => model.id)
    .join(', ');

  const merged = managedModels.map((model) => {
    const aliases = options?.aliasesByModelId?.get(model.id);
    const available = isDiscovered(model.id, aliases);
    if (available) {
      return {
        ...model,
        enabled: true,
        availability: 'available' as const,
        availabilityReason: undefined,
      };
    }

    return {
      ...model,
      enabled: false,
      availability: 'unavailable' as const,
      availabilityReason: metaOnlyDiscovery
        ? `Endpoint returned only meta model ids (${discoveredSample || 'ark-code-latest'}). Coding Plan chat still accepts catalog model ids after a successful connection test.`
        : `This catalog model was not returned by the current account or endpoint${discoveredSample ? ` (endpoint sample: ${discoveredSample})` : ''}.`,
    };
  });

  return merged;
};

export const selectSupportedCodingPlanModels = (
  providerId: string,
  models: LlmProviderModel[],
): LlmProviderModel[] => (
  providerId === 'volcengine-coding-plan'
    ? models.filter((model) => model.enabled !== false && model.availability === 'available')
    : models
);

export const buildManagedAliasIndex = (providerId: string): Map<string, readonly string[]> => {
  const map = new Map<string, readonly string[]>();
  for (const entry of getProviderModelDefinitions(providerId)) {
    map.set(entry.modelId, entry.aliases ?? []);
  }
  return map;
};
