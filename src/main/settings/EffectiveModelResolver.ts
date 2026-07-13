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
import { parseCopilotBillingTiers } from './CopilotBilling';
import { settingsService } from './SettingsService';

const MODERN_ANTHROPIC_MODELS = new Set(['claude-fable-5', 'claude-sonnet-5', 'claude-opus-4-8']);
const COPILOT_SEED_PROMPT_TOKENS = 272_000;
const ANTHROPIC_DEFAULT_PROMPT_TOKENS = 200_000;
const ANTHROPIC_MAX_PROMPT_TOKENS = 1_000_000;

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

export function buildSeedModelContribution(
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
  let contextTiers: NonNullable<CatalogModelContribution['contextTiers']>;
  if (provider.id === 'chatgpt-account') {
    contextTiers = [{ id: 'default', label: 'Codex service limit', activation: { kind: 'implicit' }, entitlement: 'granted' }];
  } else if (provider.id === 'github-copilot') {
    contextTiers = [{ id: 'default', label: 'Default', maxPromptTokens: Math.min(nominal ?? COPILOT_SEED_PROMPT_TOKENS, COPILOT_SEED_PROMPT_TOKENS), activation: { kind: 'implicit' }, entitlement: 'granted' }];
  } else if ((provider.id === 'claude-account' || provider.id === 'anthropic') && MODERN_ANTHROPIC_MODELS.has(modelId)) {
    contextTiers = [
      { id: 'default', label: 'Default', maxPromptTokens: ANTHROPIC_DEFAULT_PROMPT_TOKENS, activation: { kind: 'implicit' }, entitlement: 'granted' },
      {
        id: 'max',
        label: '1M context',
        maxPromptTokens: ANTHROPIC_MAX_PROMPT_TOKENS,
        activation: provider.id === 'claude-account'
          ? { kind: 'header', headers: { 'anthropic-beta': 'context-1m-2025-08-07' } }
          : { kind: 'implicit' },
        entitlement: provider.id === 'claude-account' ? 'unknown' : 'granted',
      },
    ];
  } else {
    contextTiers = [{
      id: 'default',
      label: 'Default',
      ...(nominal ? { maxPromptTokens: nominal } : {}),
      activation: { kind: 'implicit' },
      entitlement: 'granted',
    }];
  }
  const defaultTierCap = contextTiers[0]?.maxPromptTokens;
  const defaultBudgetTokens = Math.min(256_000, defaultTierCap ?? 256_000);
  const providerModel = provider.models.find((model) => model.id === modelId);
  const fastModelId = profile?.fast?.modelId;
  const fastEnabled = Boolean(fastModelId && (provider.id === 'github-copilot' || provider.models.some(
    (model) => model.id === fastModelId && model.enabled !== false,
  )));

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
    fast: provider.id === 'chatgpt-account'
      ? { kind: 'request-param', patch: { service_tier: 'priority' }, entitlement: 'granted', label: 'Fast' }
      : fastModelId
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

function copilotEntitlementContribution(provider: LlmProviderEntry): CatalogLayerContribution | undefined {
  if (provider.id !== 'github-copilot') return undefined;
  try {
    const raw = settingsService.getProviderOAuthSecret(provider.id);
    const bundle = JSON.parse(raw) as { copilotModelBilling?: Record<string, unknown> };
    const models = Object.entries(bundle.copilotModelBilling ?? {}).flatMap(([modelId, billing]) => {
      const contextTiers = parseCopilotBillingTiers(billing);
      return contextTiers.length > 0 ? [{ modelId, contextTiers }] : [];
    });
    if (models.length === 0) return undefined;
    return {
      source: 'entitlement',
      observedAt: provider.lastModelRefreshAt ?? provider.lastTestedAt ?? '2026-07-13T00:00:00.000Z',
      detail: 'GitHub Copilot account billing context tiers',
      models,
    };
  } catch {
    return undefined;
  }
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
    models: [...ids].map((modelId) => buildSeedModelContribution(provider, modelId)),
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
    models: provider.models.map((model) => buildSeedModelContribution(provider, model.id)),
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
    entitlement: copilotEntitlementContribution(provider),
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
