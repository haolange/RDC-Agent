import type {
  CatalogLayerContribution,
  CatalogModelContribution,
  EffectiveCatalogRequest,
} from './EffectiveCatalogService';
import { effectiveCatalogService } from './EffectiveCatalogService';
import type {
  EffectiveCatalogSnapshot,
  EffectiveModel,
  ModelRouteRecommendation,
  ModelRoute,
  RequestPlan,
  RequestPlanningResult,
} from '@shared/types/providerCapability';
import type { ConversationTurnControls, ReasoningControl } from '@shared/types/modelCapability';
import type { AppSettings, LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import { planModelRequest } from './RequestPlanner';
import { parseCopilotBillingTiers } from './CopilotBilling';
import { normalizeDiscoveredModelMatchKey } from './DiscoveryAdmission';
import { settingsService } from './SettingsService';
import { projectProtocolOverlays, resolveModelRoutePrecedence } from './ProviderRouteProjection';
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
    enabled: true,
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
  return {
    ...base,
    modelId: base.modelId,
    label: seed?.label ?? modelId,
    aliases: [...(seed?.aliases ?? [])],
    enabled: seed?.enabled ?? true,
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
  const ids = new Set<string>();
  if (provider.catalogOwnership === 'app-managed') {
    for (const entry of getProviderSeedModelDefinitions(provider.id)) {
      ids.add(entry.modelId);
    }
  }
  if (requestedModelId && provider.catalogOwnership === 'app-managed') {
    const canonical = lookupProviderSeedModel(provider.id, requestedModelId)?.modelId;
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
  const configuredModels = provider.models;
  if (configuredModels.length === 0) return undefined;
  const userManaged = provider.catalogOwnership === 'user-managed';
  return {
    source: 'user',
    observedAt: provider.lastModelRefreshAt ?? provider.lastTestedAt ?? '2026-07-13T00:00:00.000Z',
    detail: provider.catalogOwnership === 'user-managed'
      ? 'User-managed provider model definition'
      : 'User model selection state',
    models: configuredModels.map((model) => ({
      modelId: model.id,
      enabled: model.enabled !== false,
      defaultBudgetTokens: model.defaultBudgetTokens,
      reasoning: model.defaultReasoningSelection
        ? { defaultSelection: model.defaultReasoningSelection }
        : undefined,
      ...(userManaged ? {
        label: model.label,
        aliases: [...(model.aliases ?? [])],
        availability: model.availability ?? 'available',
        unavailableReason: model.availabilityReason,
      } : {}),
    })),
  };
}

export function toDiscoveryModelContributions(models: LlmProviderModel[]): CatalogModelContribution[] {
  return models.map((model) => ({
    modelId: model.id,
    label: model.label,
    aliases: model.aliases,
    availability: model.availability ?? 'available',
    unavailableReason: model.availabilityReason,
  }));
}

export function completeDiscoveryContributions(
  provider: LlmProviderEntry,
  contributions: CatalogModelContribution[],
): CatalogModelContribution[] {
  if (provider.catalogOwnership !== 'app-managed') return contributions;
  const discoveredKeys = new Set(contributions.flatMap((model) => (
    [model.modelId, ...(model.aliases ?? [])].map(normalizeDiscoveredModelMatchKey).filter(Boolean)
  )));
  const completed = [...contributions];
  for (const seed of getProviderSeedModelDefinitions(provider.id)) {
    const seedKeys = [seed.modelId, ...(seed.aliases ?? [])].map(normalizeDiscoveredModelMatchKey);
    if (seedKeys.some((value) => discoveredKeys.has(value))) continue;
    completed.push({
      modelId: seed.modelId,
      availability: 'unavailable',
      unavailableReason: 'This model was not returned by the latest successful provider discovery.',
    });
  }
  return completed;
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
  const seed = seedContribution(provider, requestedModelId);
  const observedAt = '2026-07-13T00:00:00.000Z';
  const overlay = projectProtocolOverlays(
    preset?.overlays ?? [],
    provider.protocol,
    preset ? observedAt : new Date().toISOString(),
  );
  return {
    providerId: provider.id,
    accountId: provider.activeAccountId ?? `anonymous:${provider.id}`,
    protocol: provider.protocol,
    catalogOwnership: provider.catalogOwnership,
    fallbackRoute: routeFor(provider),
    seed,
    overlay,
    entitlement: copilotEntitlementContribution(provider),
    user: userContribution(provider),
    providerAvailability: provider.status === 'unavailable'
      ? {
          state: 'unavailable',
          reason: provider.unavailableReason ?? 'Provider runtime is unavailable.',
          observedAt,
        }
      : undefined,
  };
}

export function refreshEffectiveCatalogDiscovery(
  provider: LlmProviderEntry,
  models: LlmProviderModel[],
  contributions?: CatalogModelContribution[],
  entitlementContributions?: CatalogModelContribution[],
): Promise<EffectiveCatalogSnapshot> {
  const request = buildEffectiveCatalogRequest(provider);
  const discovered = completeDiscoveryContributions(
    provider,
    contributions ?? toDiscoveryModelContributions(models),
  );
  return effectiveCatalogService.refreshDiscovery(request, async () => ({
    protocol: provider.protocol,
    models: discovered,
    ...(entitlementContributions?.length
      ? {
          entitlement: {
            protocol: provider.protocol,
            detail: 'Account catalog entitlement groups',
            models: entitlementContributions,
          },
        }
      : {}),
  }));
}

export function resolveEffectiveModel(
  providerId: string,
  modelId: string,
  settings: AppSettings,
): EffectiveModel | null {
  return resolveEffectiveModelSelection(providerId, modelId, settings).model;
}

export interface EffectiveModelSelection {
  requestedModelId: string;
  model: EffectiveModel | null;
  remappedFrom?: string;
  recommendations: ModelRouteRecommendation[];
}

export function selectEffectiveModelFromSnapshot(
  snapshot: EffectiveCatalogSnapshot,
  modelId: string,
  recommendedModelIds: readonly string[] = [],
): EffectiveModelSelection {
  const isUsable = (entry: EffectiveModel): boolean => entry.enabled !== false && entry.availability !== 'unavailable';
  const exact = snapshot.models.find((entry) => entry.modelId === modelId && isUsable(entry));
  const alias = exact ? undefined : snapshot.models.find((entry) => entry.aliases.includes(modelId) && isUsable(entry));
  const model = exact ?? alias ?? null;
  const recommendedOrder = new Map(recommendedModelIds.map((id, index) => [id, index]));
  const recommendations = snapshot.models
    .filter((entry) => entry.enabled !== false && entry.availability === 'available' && entry.modelId !== model?.modelId)
    .sort((left, right) => (
      (recommendedOrder.get(left.modelId) ?? Number.MAX_SAFE_INTEGER)
      - (recommendedOrder.get(right.modelId) ?? Number.MAX_SAFE_INTEGER)
      || left.label.localeCompare(right.label)
    ))
    .slice(0, 3)
    .map((entry) => ({ providerId: snapshot.providerId, modelId: entry.modelId, label: entry.label }));
  return {
    requestedModelId: modelId,
    model,
    ...(alias ? { remappedFrom: modelId } : {}),
    recommendations,
  };
}

export function resolveEffectiveModelSelection(
  providerId: string,
  modelId: string,
  settings: AppSettings,
): EffectiveModelSelection {
  const provider = settings.llm.providers.find((entry) => entry.id === providerId);
  if (!provider) return { requestedModelId: modelId, model: null, recommendations: [] };
  const snapshot = resolveEffectiveCatalog(providerId, settings, modelId);
  if (!snapshot) {
    return { requestedModelId: modelId, model: null, recommendations: [] };
  }
  return selectEffectiveModelFromSnapshot(
    snapshot,
    modelId,
    getProviderPreset(providerId)?.recommendedModels,
  );
}

export function planEffectiveModelRequest(input: {
  providerId: string;
  modelId: string;
  settings: AppSettings;
  controls?: Partial<ConversationTurnControls> & { reasoningLevel?: unknown };
  clientBudgetTokens?: number;
  requestedTemperature?: number;
}): RequestPlanningResult {
  const selection = resolveEffectiveModelSelection(input.providerId, input.modelId, input.settings);
  if (!selection.model) {
    const controls: ConversationTurnControls = {
      reasoningLevel: 'off',
      maxContextMode: false,
      fastModel: false,
    };
    const recommendationText = selection.recommendations.map((entry) => entry.modelId).join(', ');
    return {
      ok: false,
      code: 'MODEL_UNAVAILABLE',
      message: `MODEL_UNAVAILABLE: ${input.providerId}/${input.modelId} is not enabled or available in the effective catalog.${recommendationText ? ` Same-provider recommendations: ${recommendationText}.` : ''}`,
      controls,
      recommendations: selection.recommendations,
    };
  }
  const result = planModelRequest({
    model: selection.model,
    controls: input.controls,
    clientBudgetTokens: input.clientBudgetTokens,
    requestedTemperature: input.requestedTemperature,
  });
  if (!result.ok || !selection.remappedFrom) return result;
  return {
    ...result,
    warnings: [
      ...result.warnings,
      `Canonical model alias remap: ${selection.remappedFrom} -> ${selection.model.modelId}.`,
    ],
  };
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
  if (!provider || !model) return;
  const grantsTier = activeTier?.entitlement === 'unknown';
  const grantsFast = plan.fastMode
    && model.fast.kind !== 'unsupported'
    && model.fast.kind !== 'unknown'
    && model.fast.entitlement === 'unknown';
  if (!grantsTier && !grantsFast) return;
  const activated = [
    grantsTier && activeTier ? `context tier ${activeTier.id}` : '',
    grantsFast ? 'Fast mode' : '',
  ].filter(Boolean);
  effectiveCatalogService.recordObserved({
    providerId,
    accountId: provider.activeAccountId ?? `anonymous:${providerId}`,
    protocol: plan.route.protocol,
  }, [{
    modelId: model.modelId,
    ...(grantsTier && activeTier
      ? {
          contextTiers: model.contextTiers.map((tier) => (
            tier.id === activeTier.id ? { ...tier, entitlement: 'granted' as const } : tier
          )),
        }
      : {}),
    ...(grantsFast && model.fast.kind !== 'unsupported' && model.fast.kind !== 'unknown'
      ? { fast: { ...model.fast, entitlement: 'granted' as const } }
      : {}),
  }], `Successful request activated ${activated.join(' and ')}`);
}
