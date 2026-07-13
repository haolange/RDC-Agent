import type {
  CatalogLayerContribution,
  CatalogModelContribution,
  EffectiveCatalogRequest,
} from './EffectiveCatalogService';
import { effectiveCatalogService } from './EffectiveCatalogService';
import type {
  EffectiveCatalogSnapshot,
  EffectiveModel,
  ModelRoute,
  RequestPlan,
  RequestPlanningResult,
} from '@shared/types/providerCapability';
import type { ConversationTurnControls, ReasoningControl } from '@shared/types/modelCapability';
import type { AppSettings, LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import { planModelRequest } from './RequestPlanner';
import { parseCopilotBillingTiers } from './CopilotBilling';
import { settingsService } from './SettingsService';
import { projectProtocolOverlays, resolveModelRoutePrecedence } from './ProviderRouteProjection';
import { resolveProviderModelAvailability } from './LlmRouteCompatibility';
import {
  getProviderPreset,
  getProviderSeedModelDefinitions,
  lookupProviderSeedModel,
} from './ProviderPresetRegistry';

const CONSERVATIVE_REASONING: ReasoningControl = {
  kind: 'none',
  supportsOff: true,
  levels: [],
  defaultSelection: 'off',
  lockedSelection: 'off',
  wireProfile: { kind: 'none' },
};

function routeFor(provider: LlmProviderEntry, modelRoute?: ModelRoute): ModelRoute {
  const preset = getProviderPreset(provider.id);
  const presetRoute = preset?.routes.find((route) => route.protocol === provider.protocol)
    ?? preset?.routes.find((route) => route.default)
    ?? preset?.routes[0];
  return resolveModelRoutePrecedence({
    modelRoute: modelRoute?.source === 'model' ? modelRoute : undefined,
    userRoute: provider.protocolEditable
      ? { protocol: provider.protocol, baseUrl: provider.baseUrl }
      : undefined,
    presetRoute: {
      protocol: presetRoute?.protocol ?? provider.protocol,
      baseUrl: presetRoute?.baseUrl ?? provider.baseUrl,
      headers: presetRoute?.headers,
    },
  });
}

export function buildSeedModelContribution(
  provider: LlmProviderEntry,
  modelId: string,
): CatalogModelContribution {
  const seed = provider.catalogOwnership === 'app-managed'
    ? lookupProviderSeedModel(provider.id, modelId)
    : null;
  const conservative: CatalogModelContribution = {
    modelId,
    label: modelId,
    aliases: [],
    route: routeFor(provider),
    availability: 'unknown',
    contextTiers: [{
      id: 'default',
      label: 'Default',
      activation: { kind: 'implicit' },
      entitlement: 'granted',
    }],
    defaultBudgetTokens: 256_000,
    fast: { kind: 'unsupported' },
    reasoning: CONSERVATIVE_REASONING,
    toolCalling: { state: 'unknown' },
    visionInput: { state: 'unknown' },
    structuredOutput: { state: 'unknown' },
  };
  const base: CatalogModelContribution = seed
    ? { ...seed, route: routeFor(provider, seed.route) }
    : conservative;
  const providerModel = provider.models.find((model) => model.id === base.modelId);
  return {
    ...base,
    modelId: base.modelId,
    label: seed?.label ?? providerModel?.label ?? modelId,
    aliases: [...(seed?.aliases ?? [])],
    availability: providerModel?.availability === 'unavailable'
      ? 'unavailable'
      : providerModel?.enabled === false
        ? 'unavailable'
        : providerModel
          ? 'available'
          : base.availability,
    unavailableReason: providerModel?.availabilityReason,
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
    for (const entry of getProviderSeedModelDefinitions(provider.id)) {
      ids.add(entry.modelId);
    }
  }
  if (requestedModelId) {
    const canonical = provider.catalogOwnership === 'app-managed'
      ? lookupProviderSeedModel(provider.id, requestedModelId)?.modelId
      : requestedModelId;
    if (canonical) ids.add(canonical);
  }
  return {
    source: 'seed',
    observedAt: '2026-07-13T00:00:00.000Z',
    detail: 'Provider preset seed',
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
  return effectiveCatalogService.getSnapshot(buildEffectiveCatalogRequest(provider, requestedModelId));
}

export function buildEffectiveCatalogRequest(
  provider: LlmProviderEntry,
  requestedModelId?: string,
): EffectiveCatalogRequest {
  const preset = getProviderPreset(provider.id);
  return {
    providerId: provider.id,
    accountId: provider.activeAccountId ?? `anonymous:${provider.id}`,
    protocol: provider.protocol,
    catalogOwnership: provider.catalogOwnership,
    fallbackRoute: routeFor(provider),
    seed: seedContribution(provider, requestedModelId),
    overlay: projectProtocolOverlays(
      preset?.overlays ?? [],
      provider.protocol,
      preset ? '2026-07-13T00:00:00.000Z' : new Date().toISOString(),
    ),
    entitlement: copilotEntitlementContribution(provider),
    user: userContribution(provider),
  };
}

export function refreshEffectiveCatalogDiscovery(
  provider: LlmProviderEntry,
  models: LlmProviderModel[],
  contributions?: CatalogModelContribution[],
): Promise<EffectiveCatalogSnapshot> {
  const request = buildEffectiveCatalogRequest(provider);
  return effectiveCatalogService.refreshDiscovery(request, async () => ({
    source: 'discovery',
    observedAt: new Date().toISOString(),
    protocol: provider.protocol,
    models: contributions ?? models.map((model) => ({
      modelId: model.id,
      label: model.label,
      availability: model.availability,
      unavailableReason: model.availabilityReason,
    })),
  }));
}

export function resolveEffectiveModel(
  providerId: string,
  modelId: string,
  settings: AppSettings,
): EffectiveModel | null {
  const provider = settings.llm.providers.find((entry) => entry.id === providerId);
  if (!provider) return null;
  const availability = resolveProviderModelAvailability(provider, modelId);
  if (!availability.modelId) return null;
  const effectiveModelId = availability.modelId;
  const snapshot = resolveEffectiveCatalog(providerId, settings, effectiveModelId);
  if (!snapshot) {
    return null;
  }
  return snapshot.models.find((model) => model.modelId === effectiveModelId)
    ?? snapshot.models.find((model) => model.aliases.includes(effectiveModelId))
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
    const provider = input.settings.llm.providers.find((entry) => entry.id === input.providerId);
    const unavailable = provider
      ? resolveProviderModelAvailability(provider, input.modelId).unavailable
      : undefined;
    const controls: ConversationTurnControls = {
      reasoningLevel: 'off',
      maxContextMode: false,
      fastModel: false,
    };
    return {
      ok: false,
      code: 'MODEL_UNAVAILABLE',
      message: unavailable?.message ?? `Unknown model ${input.providerId}/${input.modelId}`,
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
