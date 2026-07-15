import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';
import type { LlmProviderCatalogOwnership, LlmProviderModel } from '@shared/types/settings';
import { findEffectiveCapabilityModel } from './modelCapabilitySummaryUtils';

export interface ProjectedProviderModel {
  model: LlmProviderModel;
  effectiveModel: EffectiveModel | null;
}

export function updateProviderModelPreference(
  catalogOwnership: LlmProviderCatalogOwnership,
  models: LlmProviderModel[],
  modelId: string,
  patch: Partial<LlmProviderModel>,
): LlmProviderModel[] {
  const incomingKeys = new Set([modelId, ...(patch.aliases ?? [])]);
  const matches = (model: LlmProviderModel): boolean => (
    incomingKeys.has(model.id)
    || (model.aliases ?? []).some((alias) => incomingKeys.has(alias))
  );
  let updated = false;
  const next = models.flatMap((model) => {
    const matchesModel = catalogOwnership !== 'user-managed' ? matches(model) : model.id === modelId;
    if (!matchesModel) return [model];
    if (updated) return [];
    updated = true;
    return [{
      ...model,
      ...patch,
      id: modelId,
      label: patch.label ?? model.label,
      enabled: patch.enabled ?? model.enabled,
    }];
  });
  if (updated) return next;
  return [...next, {
    ...patch,
    id: modelId,
    label: patch.label ?? modelId,
    enabled: patch.enabled ?? true,
  }];
}

export function projectProviderModels(
  catalogOwnership: LlmProviderCatalogOwnership,
  models: LlmProviderModel[],
  snapshot: EffectiveCatalogSnapshot | null,
): ProjectedProviderModel[] {
  if (catalogOwnership === 'user-managed' || !snapshot) {
    return models.map((model) => ({
      model,
      effectiveModel: findEffectiveCapabilityModel(snapshot, model.id),
    }));
  }
  const storedById = new Map<string, LlmProviderModel>();
  for (const stored of models) {
    storedById.set(stored.id, stored);
    for (const alias of stored.aliases ?? []) storedById.set(alias, stored);
  }
  const internalVariantIds = new Set(snapshot.models
    .filter((model) => model.selection?.pickerVisibility === 'internal')
    .flatMap((model) => [model.modelId, ...model.aliases]));
  const projected = snapshot.models
    .filter((effectiveModel) => effectiveModel.selection?.pickerVisibility !== 'internal')
    .map((effectiveModel) => {
    const stored = storedById.get(effectiveModel.modelId)
      ?? effectiveModel.aliases.map((alias) => storedById.get(alias)).find(Boolean);
    return {
      effectiveModel,
      model: {
        id: effectiveModel.modelId,
        label: effectiveModel.label,
        enabled: stored?.enabled ?? effectiveModel.enabled,
        aliases: [...effectiveModel.aliases],
        availability: effectiveModel.availability,
        availabilityReason: effectiveModel.unavailableReason,
        defaultReasoningSelection: stored?.defaultReasoningSelection,
        defaultBudgetTokens: stored?.defaultBudgetTokens,
        preferredRouteOptionId: stored?.preferredRouteOptionId,
      },
    };
    });
  const projectedIds = new Set(projected.flatMap(({ model }) => [model.id, ...(model.aliases ?? [])]));
  return [
    ...projected,
    ...models
      .filter((model) => !projectedIds.has(model.id) && !internalVariantIds.has(model.id))
      .map((model) => ({ model, effectiveModel: null })),
  ];
}
