import {
  getManagedProviderModelCatalog,
  lookupManagedModelCatalogEntry,
} from '@shared/constants/modelCapabilityCatalog';
import type {
  CatalogLayerContribution,
  CatalogModelContribution,
} from './EffectiveCatalogService';
import {
  effectiveCatalogService,
} from './EffectiveCatalogService';
import type {
  EffectiveCatalogSnapshot,
  EffectiveModel,
  ModelRoute,
  RequestPlan,
  RequestPlanningResult,
} from '@shared/types/providerCapability';
import type {
  ConversationTurnControls,
  ReasoningControl,
} from '@shared/types/modelCapability';
import { createReasoningControl } from '@shared/types/modelCapability';
import type {
  AppSettings,
  LlmProviderEntry,
} from '@shared/types/settings';
import { planModelRequest } from './RequestPlanner';

const CONSERVATIVE_REASONING: ReasoningControl = {
  kind: 'none',
  supportsOff: true,
  levels: [],
  defaultSelection: 'off',
  lockedSelection: 'off',
  wireProfile: { kind: 'none' },
};

function routeFor(provider: LlmProviderEntry): ModelRoute {
  return {
    protocol: provider.protocol,
    baseUrl: provider.baseUrl,
    source: provider.protocolEditable ? 'user' : 'preset',
  };
}

function seedModel(
  provider: LlmProviderEntry,
  modelId: string,
): CatalogModelContribution {
  const entry = provider.catalogOwnership === 'app-managed'
    ? lookupManagedModelCatalogEntry(provider.id, modelId)
    : null;
  const profile = entry?.profile;
  const nominal = typeof profile?.nominalContextWindowTokens === 'number'
    && profile.nominalContextWindowTokens > 0
    ? profile.nominalContextWindowTokens
    : undefined;
  const defaultBudgetTokens = nominal ? Math.min(256_000, nominal) : 256_000;
  const contextTiers: CatalogModelContribution['contextTiers'] = [{
    id: 'default',
    label: 'Default',
    ...(nominal ? { maxPromptTokens: nominal } : {}),
    activation: { kind: 'implicit' },
    entitlement: 'granted',
  }];
  const providerModel = provider.models.find((model) => model.id === modelId);
  const fastModelId = profile?.fast?.modelId;
  const fastEnabled = Boolean(fastModelId && provider.models.some(
    (model) => model.id === fastModelId && model.enabled !== false,
  ));

  return {
    modelId,
    label: entry?.label ?? providerModel?.label ?? modelId,
    aliases: [...(entry?.aliases ?? [])],
    route: routeFor(provider),
    availability: providerModel?.availability === 'unavailable'
      ? 'unavailable'
      : providerModel?.enabled === false
        ? 'unavailable'
        : providerModel
          ? 'available'
          : 'unknown',
    unavailableReason: providerModel?.availabilityReason,
    contextTiers,
    defaultBudgetTokens,
    fast: fastModelId
      ? {
          kind: 'model-variant',
          modelId: fastModelId,
          entitlement: fastEnabled ? 'granted' : 'denied',
        }
      : { kind: 'unsupported' },
    reasoning: createReasoningControl(profile?.reasoningControl ?? CONSERVATIVE_REASONING),
    toolCalling: profile?.toolCalling === true
      ? { state: 'supported' }
      : profile?.toolCalling === false ? { state: 'unsupported' } : { state: 'unknown' },
    visionInput: profile?.visionInput === true
      ? { state: 'supported' }
      : profile?.visionInput === false ? { state: 'unsupported' } : { state: 'unknown' },
    structuredOutput: profile?.structuredOutput === true
      ? { state: 'supported' }
      : profile?.structuredOutput === false ? { state: 'unsupported' } : { state: 'unknown' },
    fixedTemperature: profile?.fixedTemperature,
  };
}

function seedContribution(provider: LlmProviderEntry, requestedModelId?: string): CatalogLayerContribution {
  const ids = new Set(provider.models.map((model) => model.id));
  if (provider.catalogOwnership === 'app-managed') {
    for (const entry of getManagedProviderModelCatalog(provider.id)) {
      ids.add(entry.id);
    }
  }
  if (requestedModelId) {
    ids.add(requestedModelId);
  }
  return {
    source: 'seed',
    observedAt: '2026-07-13T00:00:00.000Z',
    detail: 'Bundled legacy seed pending preset migration',
    models: [...ids].map((modelId) => seedModel(provider, modelId)),
  };
}

function userContribution(provider: LlmProviderEntry): CatalogLayerContribution | undefined {
  if (provider.catalogOwnership !== 'user-managed') {
    return undefined;
  }
  return {
    source: 'user',
    observedAt: provider.lastModelRefreshAt ?? provider.lastTestedAt ?? '2026-07-13T00:00:00.000Z',
    detail: 'User-managed provider model definition',
    models: provider.models.map((model) => seedModel(provider, model.id)),
  };
}

export function resolveEffectiveCatalog(
  providerId: string,
  settings: AppSettings,
  requestedModelId?: string,
): EffectiveCatalogSnapshot | null {
  const provider = settings.llm.providers.find((entry) => entry.id === providerId);
  if (!provider) {
    return null;
  }
  return effectiveCatalogService.getSnapshot({
    providerId,
    accountId: provider.activeAccountId ?? `anonymous:${providerId}`,
    protocol: provider.protocol,
    catalogOwnership: provider.catalogOwnership,
    fallbackRoute: routeFor(provider),
    seed: seedContribution(provider, requestedModelId),
    user: userContribution(provider),
  });
}

export function resolveEffectiveModel(
  providerId: string,
  modelId: string,
  settings: AppSettings,
): EffectiveModel | null {
  const snapshot = resolveEffectiveCatalog(providerId, settings, modelId);
  if (!snapshot) {
    return null;
  }
  return snapshot.models.find((model) => model.modelId === modelId)
    ?? snapshot.models.find((model) => model.aliases.includes(modelId))
    ?? null;
}

export function planEffectiveModelRequest(input: {
  providerId: string;
  modelId: string;
  settings: AppSettings;
  controls?: Partial<ConversationTurnControls> & { reasoningLevel?: unknown };
  clientBudgetTokens?: number;
  requestedTemperature?: number;
}): RequestPlanningResult {
  const model = resolveEffectiveModel(input.providerId, input.modelId, input.settings);
  if (!model) {
    const controls: ConversationTurnControls = {
      reasoningLevel: 'off',
      maxContextMode: false,
      fastModel: false,
    };
    return {
      ok: false,
      code: 'MODEL_UNAVAILABLE',
      message: `Unknown model ${input.providerId}/${input.modelId}`,
      controls,
    };
  }
  return planModelRequest({
    model,
    controls: input.controls,
    clientBudgetTokens: input.clientBudgetTokens,
    requestedTemperature: input.requestedTemperature,
  });
}

export function recordEffectivePlanSuccess(
  providerId: string,
  modelId: string,
  settings: AppSettings,
  plan: RequestPlan,
): void {
  const provider = settings.llm.providers.find((entry) => entry.id === providerId);
  const model = resolveEffectiveModel(providerId, modelId, settings);
  const activeTier = model?.contextTiers.find((tier) => tier.id === plan.activeTierId);
  if (!provider || !model || activeTier?.entitlement !== 'unknown') return;
  effectiveCatalogService.recordObserved({
    providerId,
    accountId: provider.activeAccountId ?? `anonymous:${providerId}`,
    protocol: plan.route.protocol,
  }, [{
    modelId,
    contextTiers: model.contextTiers.map((tier) => (
      tier.id === activeTier.id ? { ...tier, entitlement: 'granted' as const } : tier
    )),
  }], `Successful request activated context tier ${activeTier.id}`);
}
