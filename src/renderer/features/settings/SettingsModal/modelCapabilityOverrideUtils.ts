import { lookupModelCapabilitySeed } from '@shared/constants/modelCapabilityCatalog';
import { EFFORT_LEVELS, type EffortLevel, type ModelCapabilityProfile } from '@shared/types/modelCapability';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import type { useI18n } from '../../../i18n';
import { formatTokenCount } from '../../debugger/composer/turnControlsUtils';

type Translate = ReturnType<typeof useI18n>['t'];

const EFFORT_LABEL_KEYS = {
  low: 'composer.effort.levelLow',
  medium: 'composer.effort.levelMedium',
  high: 'composer.effort.levelHigh',
  extra: 'composer.effort.levelExtra',
  max: 'composer.effort.levelMax',
} as const satisfies Record<EffortLevel, Parameters<Translate>[0]>;

export function normalizeCapabilityOverride(
  override?: ModelCapabilityProfile,
): ModelCapabilityProfile | undefined {
  if (!override) {
    return undefined;
  }
  const profile: ModelCapabilityProfile = {};
  if (
    typeof override.nominalContextWindowTokens === 'number'
    && Number.isFinite(override.nominalContextWindowTokens)
    && override.nominalContextWindowTokens > 0
  ) {
    profile.nominalContextWindowTokens = Math.round(override.nominalContextWindowTokens);
  }
  if (Array.isArray(override.supportedEffortLevels) && override.supportedEffortLevels.length > 0) {
    profile.supportedEffortLevels = override.supportedEffortLevels.filter((level): level is EffortLevel =>
      (EFFORT_LEVELS as readonly string[]).includes(level),
    );
    if (profile.supportedEffortLevels.length === 0) {
      delete profile.supportedEffortLevels;
    }
  }
  if (typeof override.fastVariantModelId === 'string' && override.fastVariantModelId.trim()) {
    profile.fastVariantModelId = override.fastVariantModelId.trim();
  }
  return Object.keys(profile).length > 0 ? profile : undefined;
}

export function mergeModelCapabilityOverrides(
  previousModels: LlmProviderModel[],
  nextModels: LlmProviderModel[],
): LlmProviderModel[] {
  const overrideById = new Map(
    previousModels
      .map((model) => [model.id, normalizeCapabilityOverride(model.capabilityOverride)] as const)
      .filter((entry): entry is [string, ModelCapabilityProfile] => Boolean(entry[1])),
  );
  return nextModels.map((model) => {
    const capabilityOverride = overrideById.get(model.id);
    return capabilityOverride ? { ...model, capabilityOverride } : model;
  });
}

export function applyDraftCapabilityOverrides(
  provider: LlmProviderEntry,
  draftModels: LlmProviderModel[],
): LlmProviderEntry {
  const overrideById = new Map(
    draftModels.map((model) => [model.id, normalizeCapabilityOverride(model.capabilityOverride)]),
  );
  return {
    ...provider,
    models: provider.models.map((model) => {
      if (!overrideById.has(model.id)) {
        return model;
      }
      const capabilityOverride = overrideById.get(model.id);
      if (capabilityOverride) {
        return { ...model, capabilityOverride };
      }
      const { capabilityOverride: _removed, ...rest } = model;
      return rest;
    }),
  };
}

export function hasActiveCapabilityOverride(model: LlmProviderModel): boolean {
  return Boolean(normalizeCapabilityOverride(model.capabilityOverride));
}

export function formatSeedContextPlaceholder(modelId: string, t: Translate): string {
  const seed = lookupModelCapabilitySeed(modelId);
  if (!seed?.nominalContextWindowTokens) {
    return t('settings.providers.capability.seedUnknown');
  }
  return formatTokenCount(seed.nominalContextWindowTokens);
}

export function formatSeedEffortPlaceholder(modelId: string, t: Translate): string {
  const seed = lookupModelCapabilitySeed(modelId);
  if (!seed?.supportedEffortLevels || seed.supportedEffortLevels.length === 0) {
    return t('settings.providers.capability.seedEffortNone');
  }
  return seed.supportedEffortLevels.map((level) => t(EFFORT_LABEL_KEYS[level])).join(', ');
}

export function formatSeedFastPlaceholder(modelId: string, t: Translate): string {
  const seed = lookupModelCapabilitySeed(modelId);
  if (!seed?.fastVariantModelId) {
    return t('settings.providers.capability.seedFastNone');
  }
  return seed.fastVariantModelId;
}

export function getEffortLabelKey(level: EffortLevel): typeof EFFORT_LABEL_KEYS[EffortLevel] {
  return EFFORT_LABEL_KEYS[level];
}
