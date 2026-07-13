import { lookupManagedModelCatalogEntry } from '@shared/constants/modelCapabilityCatalog';
import type { EffectiveModel } from '@shared/types/providerCapability';
import type {
  ReasoningControl,
  ResolvedModelCapability,
} from '@shared/types/modelCapability';
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  MAX_CONTEXT_MODE_MIN_TOKENS,
  createReasoningControl,
} from '@shared/types/modelCapability';
import type { AppSettings } from '@shared/types/settings';

const CONSERVATIVE_REASONING: ReasoningControl = {
  kind: 'none',
  supportsOff: true,
  levels: [],
  defaultSelection: 'off',
  wireProfile: { kind: 'none' },
};

export function createLegacyEquivalentEffectiveModel(
  providerId: string,
  modelId: string,
  settings: AppSettings,
): EffectiveModel {
  const provider = settings.llm.providers.find((entry) => entry.id === providerId);
  const catalogEntry = provider?.catalogOwnership === 'app-managed'
    ? lookupManagedModelCatalogEntry(providerId, modelId)
    : null;
  const profile = catalogEntry?.profile;
  const nominal = typeof profile?.nominalContextWindowTokens === 'number'
    && profile.nominalContextWindowTokens > 0
    ? profile.nominalContextWindowTokens
    : undefined;
  const defaultBudgetTokens = nominal
    ? Math.min(DEFAULT_CONTEXT_WINDOW_TOKENS, nominal)
    : DEFAULT_CONTEXT_WINDOW_TOKENS;
  const contextTiers: EffectiveModel['contextTiers'] = [{
    id: 'default',
    label: 'Default',
    maxPromptTokens: defaultBudgetTokens,
    activation: { kind: 'implicit' },
    entitlement: 'granted',
  }];
  if (nominal && nominal >= MAX_CONTEXT_MODE_MIN_TOKENS) {
    contextTiers.push({
      id: 'max',
      label: 'Max',
      maxPromptTokens: nominal,
      activation: { kind: 'implicit' },
      entitlement: 'granted',
    });
  } else if (nominal) {
    contextTiers[0].maxPromptTokens = nominal;
  }
  const fastVariantModelId = profile?.fastVariantModelId;
  const fastEnabled = Boolean(fastVariantModelId && provider?.models.some(
    (model) => model.id === fastVariantModelId && model.enabled !== false,
  ));
  const observedAt = catalogEntry?.source.updatedAt ?? '1970-01-01T00:00:00.000Z';

  return {
    providerId,
    modelId,
    label: catalogEntry?.label ?? modelId,
    aliases: [...(catalogEntry?.aliases ?? [])],
    route: {
      protocol: provider?.protocol ?? 'OpenAICompatibleChatCompletions',
      baseUrl: provider?.baseUrl,
      source: provider?.protocolEditable ? 'user' : 'preset',
    },
    availability: provider?.models.some((model) => model.id === modelId && model.enabled !== false)
      ? 'available'
      : 'unknown',
    contextTiers,
    defaultBudgetTokens,
    fast: fastVariantModelId
      ? {
          kind: 'model-variant',
          modelId: fastVariantModelId,
          entitlement: fastEnabled ? 'granted' : 'denied',
        }
      : { kind: 'unsupported' },
    reasoning: createReasoningControl(profile?.reasoningControl ?? CONSERVATIVE_REASONING),
    toolCalling: profile?.toolCalling ? { state: 'supported' } : { state: 'unsupported' },
    visionInput: profile?.visionInput ? { state: 'supported' } : { state: 'unsupported' },
    structuredOutput: profile?.structuredOutput ? { state: 'supported' } : { state: 'unsupported' },
    fixedTemperature: profile?.fixedTemperature,
    provenance: [{
      field: '*',
      source: 'seed',
      observedAt,
      detail: catalogEntry ? 'managed-catalog' : 'conservative-default',
    }],
  };
}

export function projectLegacyResolvedCapability(model: EffectiveModel): ResolvedModelCapability {
  const managed = model.provenance.some((evidence) => evidence.detail === 'managed-catalog');
  const highestTier = model.contextTiers[model.contextTiers.length - 1];
  const hasMaxTier = model.contextTiers.length > 1;
  const fastVariant = model.fast.kind === 'model-variant' ? model.fast : null;
  return {
    providerId: model.providerId,
    modelId: model.modelId,
    catalogSource: managed ? 'managed-catalog' : 'conservative-default',
    nominalContextWindowTokens: managed ? highestTier?.maxPromptTokens ?? null : null,
    defaultContextWindowTokens: model.defaultBudgetTokens ?? DEFAULT_CONTEXT_WINDOW_TOKENS,
    maxContextWindowTokens: hasMaxTier ? highestTier?.maxPromptTokens ?? null : null,
    reasoningControl: createReasoningControl(model.reasoning),
    maxContextAvailable: hasMaxTier,
    fastVariantModelId: fastVariant?.modelId ?? null,
    fastModelAvailable: fastVariant?.entitlement === 'granted',
    fixedTemperature: typeof model.fixedTemperature === 'number' ? model.fixedTemperature : null,
    toolCalling: model.toolCalling.state === 'supported',
    visionInput: model.visionInput.state === 'supported',
    structuredOutput: model.structuredOutput.state === 'supported',
  };
}
