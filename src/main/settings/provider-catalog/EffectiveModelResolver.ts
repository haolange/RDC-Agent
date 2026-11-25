import { z } from 'zod';
import { isAgentToolExecutableModel } from '@shared/utils/agentToolCapability';
import { modelsOverrideService } from '../settings-core/ModelsOverrideService';
import { parseCopilotBillingContribution } from '../provider-auth/CopilotBilling';
import { settingsService } from '../settings-core/SettingsService';
import {
  getLoadedProviderSurface,
  getProviderCatalogRevision,
  getProviderModelDefinitions,
  lookupProviderModelDefinition,
} from '../../provider-catalog/ProviderCatalogRegistry';
import { isProbeAvailabilityDenied } from './ProviderProbeEvidence';
import { effectiveCatalogService } from './EffectiveCatalogService';
import { providerConnectionRevision } from './effectiveCatalogMerge';
import { planModelRequest } from './RequestPlanner';
import { normalizeDiscoveredModelMatchKey } from './DiscoveryAdmission';
import { projectModelProtocolOverlays, resolveModelRoutePrecedence } from './ProviderRouteProjection';
import type { ProviderLookup } from '../settings-core/providerUserState';
import type {
  CatalogLayerContribution,
  CatalogModelContribution,
  EffectiveCatalogRequest,
} from './effectiveCatalogTypes';
import type { ModelOverride, CustomModel } from '@shared/provider-catalog/modelsOverrideSchema';
import type { EffectiveCatalogSnapshot, EffectiveModel, CatalogModelRoute } from '@shared/types/providerCapability';
import type { ModelRouteRecommendation, RequestPlanningResult } from './providerCatalogTypes';
import type { ConversationTurnControls, ReasoningControl } from '@shared/types/modelCapability';
import type { LlmModelCapabilityProbeMode, LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';

const CONSERVATIVE_REASONING: ReasoningControl = {
  kind: 'unknown',
  supportsOff: false,
  levels: [],
  defaultSelection: 'off',
  wireProfile: { kind: 'none' },
};

function routeFor(
  provider: LlmProviderEntry,
  modelRoute?: CatalogModelRoute,
  selectedProtocol = modelRoute?.protocol ?? provider.protocol,
): CatalogModelRoute {
  const surface = getLoadedProviderSurface(provider.id);
  const targetProtocol = selectedProtocol;
  const catalogRoute = surface?.routes.find((route) => route.protocol === targetProtocol)
    ?? surface?.routes.find((route) => route.default)
    ?? surface?.routes[0];
  if (!surface) {
    return {
      protocol: provider.protocol,
      baseUrl: provider.baseUrl,
      source: 'user',
    };
  }
  const explicitModelRoute = modelRoute?.source === 'model' ? modelRoute : undefined;
  const configuredBaseUrl = surface.baseUrlEditable && surface.endpointClass === 'local-service'
    && provider.catalogOwnership === 'user-managed'
    ? provider.baseUrl?.trim()
    : undefined;
  const hasConfiguredOverride = Boolean(configuredBaseUrl && configuredBaseUrl !== catalogRoute?.baseUrl);
  const route = resolveModelRoutePrecedence({
    modelRoute: explicitModelRoute,
    catalogRoute: {
      protocol: catalogRoute?.protocol ?? targetProtocol,
      baseUrl: hasConfiguredOverride ? configuredBaseUrl : catalogRoute?.baseUrl ?? provider.baseUrl,
      headers: { ...(catalogRoute?.headers ?? {}) },
      contracts: catalogRoute?.contracts,
    },
  });
  return hasConfiguredOverride && !explicitModelRoute ? { ...route, source: 'user' } : route;
}

export function buildCatalogModelContribution(
  provider: LlmProviderEntry,
  modelId: string,
): CatalogModelContribution {
  const definition = lookupProviderModelDefinition(provider.id, modelId);
  const surface = getLoadedProviderSurface(provider.id);
  const factSource = definition
    ? surface?.factSources.find((source) => source.id === definition.factSourceId)
    : undefined;
  const conservative: CatalogModelContribution = {
    modelId,
    label: modelId,
    aliases: [],
    enabled: true,
    route: routeFor(provider),
    presencePolicy: 'discovered',
    availability: 'unknown',
    contextTiers: [{
      id: 'default',
      label: 'Default',
      activation: { kind: 'implicit' },
      entitlement: 'unknown',
    }],
    defaultBudgetTokens: 0,
    controls: {
      fast: { state: 'unknown', defaultValue: false, reason: 'Fast capability has not been verified.' },
      maxContext: { state: 'unknown', defaultValue: false, reason: 'Max mode capability has not been verified.' },
      reasoning: CONSERVATIVE_REASONING,
    },
    toolCalling: { state: 'unknown' },
    visionInput: { state: 'unknown' },
    structuredOutput: { state: 'unknown' },
  };
  const catalogDefinition = definition
    ? (({
        factSourceId: _factSourceId,
        fieldFactSourceIds: _fieldFactSourceIds,
        liveProjection: _liveProjection,
        ...fields
      }) => fields)(definition)
    : null;
  const selectedCatalogProtocol = catalogDefinition?.routeOptions?.some((option) => (
    option.route.protocol === provider.protocol
  ))
    ? provider.protocol
    : catalogDefinition?.route?.protocol ?? provider.protocol;
  const base: CatalogModelContribution = catalogDefinition
    ? {
        ...catalogDefinition,
        route: routeFor(provider, catalogDefinition.route, selectedCatalogProtocol),
        routeOptions: catalogDefinition.routeOptions?.map((option) => ({
          ...option,
          route: routeFor(provider, option.route, option.route.protocol),
        })),
      }
    : conservative;
  return {
    ...base,
    modelId: base.modelId,
    label: definition?.label ?? modelId,
    aliases: [...(definition?.aliases ?? [])],
    enabled: definition?.enabled ?? true,
    availability: definition?.presencePolicy === 'maintained'
      ? definition.availability
      : definition?.availability === 'unavailable'
        ? 'unavailable'
        : 'unknown',
    unavailableReason: definition?.availability === 'unavailable' ? definition.unavailableReason : undefined,
    ...(factSource ? {
      factSource: {
        sourceKind: factSource.sourceKind,
        observedAt: factSource.observedAt,
        refreshedAt: factSource.refreshedAt,
        sourceRevision: factSource.sourceRevision,
        surface: factSource.surface,
        accountScope: factSource.accountScope,
        surfaceBuild: factSource.surfaceBuild,
        plan: factSource.plan,
        detail: `Compiled fact source ${factSource.id}`,
      },
    } : {}),
    ...(definition?.fieldFactSourceIds && surface ? {
      fieldFactSources: Object.fromEntries(Object.entries(definition.fieldFactSourceIds).map(([fieldPath, sourceId]) => {
        const source = surface.factSources.find((entry) => entry.id === sourceId);
        if (!source) throw new Error(`Compiled fact source ${sourceId} is missing for ${provider.id}/${definition.modelId}.`);
        return [fieldPath, {
          sourceKind: source.sourceKind,
          observedAt: source.observedAt,
          refreshedAt: source.refreshedAt,
          sourceRevision: source.sourceRevision,
          surface: source.surface,
          accountScope: source.accountScope,
          surfaceBuild: source.surfaceBuild,
          plan: source.plan,
          detail: `Compiled field fact source ${source.id}`,
        }];
      })),
    } : {}),
  };
}

/** Context tiers an account's own billing data grants, when its sign-in stored any. */
function accountBillingEntitlement(provider: LlmProviderEntry): CatalogLayerContribution | undefined {
  if (provider.authMode !== 'account') return undefined;
  let value: unknown;
  try {
    value = JSON.parse(settingsService.getProviderOAuthSecret(provider.id));
  } catch {
    return undefined;
  }
  // A sign-in that stored no billing data (or no bundle at all) grants nothing.
  const bundle = AccountBillingBundleSchema.safeParse(value);
  if (!bundle.success) return undefined;
  const models = Object.entries(bundle.data.copilotModelBilling ?? {})
    .flatMap(([modelId, billing]) => parseCopilotBillingContribution(modelId, billing) ?? []);
  if (models.length === 0) return undefined;
  return {
    source: 'entitlement',
    observedAt: provider.lastModelRefreshAt ?? provider.lastTestedAt ?? '2026-07-13T00:00:00.000Z',
    detail: `${provider.label} account billing context tiers`,
    models,
  };
}

const AccountBillingBundleSchema = z.object({ copilotModelBilling: z.record(z.string(), z.unknown()).optional() });

function catalogContribution(provider: LlmProviderEntry, requestedModelId?: string): CatalogLayerContribution {
  const surface = getLoadedProviderSurface(provider.id);
  const ids = new Set<string>();
  if (provider.catalogOwnership !== 'user-managed') {
    for (const entry of getProviderModelDefinitions(provider.id)) {
      ids.add(entry.modelId);
    }
  }
  if (requestedModelId && provider.catalogOwnership !== 'user-managed') {
    const canonical = lookupProviderModelDefinition(provider.id, requestedModelId)?.modelId;
    if (canonical) ids.add(canonical);
  }
  return {
    source: 'catalog',
    sourceKind: 'rdc-agent',
    observedAt: surface?.factSources.find((source) => source.id === surface.defaultFactSourceId)?.observedAt
      ?? surface?.factSources.find((source) => source.id === surface.defaultFactSourceId)?.refreshedAt
      ?? '2026-07-13T00:00:00.000Z',
    refreshedAt: surface?.factSources.find((source) => source.id === surface.defaultFactSourceId)?.refreshedAt,
    sourceRevision: getProviderCatalogRevision(),
    surface: surface?.id,
    detail: 'Compiled Provider Catalog manifest',
    models: [...ids].map((modelId) => buildCatalogModelContribution(provider, modelId)),
  };
}

function userContribution(provider: LlmProviderEntry): CatalogLayerContribution | undefined {
  const configuredModels = provider.models;
  if (configuredModels.length === 0) return undefined;
  const userManaged = provider.catalogOwnership === 'user-managed';
  const surface = getLoadedProviderSurface(provider.id);
  // Only additive user-managed surfaces may expose the full surface route matrix as
  // per-model options (e.g. Custom OpenAI Endpoint). Authoritative live catalogs such
  // as OpenRouter must not inherit the whole surface protocol enum.
  const userRouteOptions = userManaged
    && surface
    && surface.routes.length > 1
    && surface.discovery.authority === 'additive'
    ? surface.routes.map((route) => ({
        id: route.id,
        label: route.protocol,
        route: {
          protocol: route.protocol,
          baseUrl: provider.baseUrl ?? route.baseUrl,
          headers: route.headers,
          contracts: route.contracts,
          source: 'user' as const,
        },
        availability: 'unknown' as const,
        protocolOwner: route.protocolOwner,
        endpointOwner: surface.serviceOperator,
        authMode: provider.authMode === 'account' ? 'account' as const : provider.authMode,
      }))
    : undefined;
  return {
    source: 'user',
    observedAt: provider.lastModelRefreshAt ?? provider.lastTestedAt ?? '2026-07-13T00:00:00.000Z',
    detail: provider.catalogOwnership === 'user-managed'
      ? 'User-managed provider model definition'
      : 'User model selection state',
    models: configuredModels.map((model) => ({
      modelId: model.id,
      enabled: model.enabled !== false,
      preferredRouteOptionId: model.preferredRouteOptionId,
      defaultBudgetTokens: model.defaultBudgetTokens,
      controls: model.defaultReasoningSelection
        ? { reasoning: { defaultSelection: model.defaultReasoningSelection } }
        : undefined,
      ...(userManaged ? {
        label: model.label,
        aliases: [...(model.aliases ?? [])],
        availability: model.availability ?? 'available',
        unavailableReason: model.availabilityReason,
      } : {}),
      ...(userRouteOptions ? { routeOptions: userRouteOptions } : {}),
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

export function applyDiscoveryAuthority(
  provider: LlmProviderEntry,
  contributions: CatalogModelContribution[],
): CatalogModelContribution[] {
  const surface = getLoadedProviderSurface(provider.id);
  if (!surface || surface.discovery.authority !== 'authoritative-list') return contributions;
  const discoveredKeys = new Set(contributions.flatMap((model) => (
    [model.modelId, ...(model.aliases ?? [])].map(normalizeDiscoveredModelMatchKey).filter(Boolean)
  )));
  const completed = [...contributions];
  for (const definition of getProviderModelDefinitions(provider.id)) {
    if (definition.presencePolicy === 'maintained') continue;
    const definitionKeys = [definition.modelId, ...definition.aliases].map(normalizeDiscoveredModelMatchKey);
    if (definitionKeys.some((value) => discoveredKeys.has(value))) continue;
    completed.push({
      modelId: definition.modelId,
      availability: 'unavailable',
      unavailableReason: `The last successful ${surface.label} catalog did not list this model.`,
    });
  }
  return completed;
}

function userOverrideContribution(provider: LlmProviderEntry): CatalogLayerContribution | undefined {
  let overrides;
  try {
    overrides = modelsOverrideService.getOverrides();
  } catch {
    return undefined;
  }
  const providerOverride = overrides.providers[provider.id];
  if (!providerOverride) return undefined;
  const observedAt = new Date().toISOString();
  const models: CatalogModelContribution[] = [];
  for (const [modelId, override] of Object.entries(providerOverride.modelOverrides ?? {})) {
    models.push(modelOverrideToContribution(modelId, override));
  }
  for (const custom of providerOverride.models ?? []) {
    models.push(customModelToContribution(custom, provider));
  }
  if (models.length === 0) return undefined;
  return {
    source: 'user',
    sourceKind: 'user',
    observedAt,
    detail: 'User model overrides (models.json)',
    models,
  };
}

function modelOverrideToContribution(modelId: string, override: ModelOverride): CatalogModelContribution {
  const contribution: CatalogModelContribution = { modelId };
  if (override.contextWindow !== undefined) {
    contribution.defaultBudgetTokens = override.contextWindow;
  }
  if (override.contextWindow !== undefined || override.maxTokens !== undefined) {
    contribution.contextTiers = [{
      id: 'default',
      ...(override.contextWindow !== undefined ? { maxPromptTokens: override.contextWindow } : {}),
      ...(override.maxTokens !== undefined ? { maxOutputTokens: override.maxTokens } : {}),
    }];
  }
  if (override.cost) {
    contribution.cost = { ...override.cost };
  }
  if (override.status === 'retiring') {
    contribution.availability = 'unavailable';
    contribution.unavailableReason = 'Marked retiring by user override (models.json).';
  }
  if (override.reasoning !== undefined) {
    contribution.controls = {
      reasoning: override.reasoning
        ? { kind: 'unknown', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } }
        : { kind: 'none', supportsOff: false, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
    };
  }
  if (override.input) {
    contribution.visionInput = override.input.includes('image')
      ? { state: 'supported' }
      : { state: 'unsupported', reason: 'User override: image input not declared.' };
  }
  return contribution;
}

function customModelToContribution(custom: CustomModel, provider: LlmProviderEntry): CatalogModelContribution {
  return {
    modelId: custom.id,
    label: custom.name,
    aliases: [],
    enabled: true,
    availability: 'available',
    presencePolicy: 'discovered',
    defaultBudgetTokens: custom.contextWindow,
    route: {
      protocol: provider.protocol,
      baseUrl: custom.baseUrl,
      source: 'user',
    },
    contextTiers: [{
      id: 'default',
      label: 'Default',
      maxPromptTokens: custom.contextWindow,
      ...(typeof custom.maxTokens === 'number' && custom.maxTokens > 0
        ? { maxOutputTokens: custom.maxTokens }
        : {}),
      activation: { kind: 'implicit' },
      entitlement: 'unknown',
    }],
    controls: {
      fast: { state: 'unknown', defaultValue: false },
      maxContext: { state: 'unsupported', fixedValue: false },
      reasoning: custom.reasoning
        ? { kind: 'unknown', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } }
        : { kind: 'none', supportsOff: false, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
    },
    toolCalling: { state: 'unknown' },
    visionInput: custom.input.includes('image')
      ? { state: 'supported' }
      : { state: 'unsupported' },
    structuredOutput: { state: 'unknown' },
    ...(custom.cost ? { cost: { ...custom.cost } } : {}),
    custom: true,
  };
}

export function resolveEffectiveCatalog(
  providerId: string,
  providers: ProviderLookup,
  requestedModelId?: string,
  accountIdOverride?: string,
): EffectiveCatalogSnapshot | null {
  const provider = providers.get(providerId);
  if (!provider) {
    return null;
  }
  const request = buildEffectiveCatalogRequest(provider, requestedModelId);
  if (accountIdOverride && accountIdOverride !== request.accountId) {
    return effectiveCatalogService.getSnapshot({ ...request, accountId: accountIdOverride });
  }
  return effectiveCatalogService.getSnapshot(request);
}

/** Upper bound on how long a turn waits for a provider's first catalog load. */
export const FIRST_CATALOG_LOAD_WAIT_MS = 8_000;

/**
 * Before the first catalog load finishes, every model reads as availability unknown. A turn started in
 * that window waits for the load (bounded) instead of failing as "unverified"; later loads never block.
 */
export async function awaitFirstCatalogLoad(
  providerId: string,
  providers: ProviderLookup,
  signal?: AbortSignal,
  timeoutMs = FIRST_CATALOG_LOAD_WAIT_MS,
): Promise<void> {
  const provider = providers.get(providerId);
  if (!provider) return;
  const request = buildEffectiveCatalogRequest(provider);
  effectiveCatalogService.getSnapshot(request);
  const pending = effectiveCatalogService.firstLoad(request);
  if (!pending) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      pending.then(() => undefined, () => undefined),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, timeoutMs); }),
      new Promise<void>((resolve) => {
        onAbort = resolve;
        signal?.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
  }
}

export function buildEffectiveCatalogRequest(
  provider: LlmProviderEntry,
  requestedModelId?: string,
): EffectiveCatalogRequest {
  const surface = getLoadedProviderSurface(provider.id);
  const catalog = catalogContribution(provider, requestedModelId);
  const observedAt = '2026-07-13T00:00:00.000Z';
  const preferredProtocols = new Map((surface?.models ?? []).map((model) => {
    const preferredRouteOptionId = provider.models.find((entry) => entry.id === model.modelId)
      ?.preferredRouteOptionId;
    const preferredRoute = preferredRouteOptionId
      ? model.routeOptions?.find((option) => option.id === preferredRouteOptionId)
      : undefined;
    return [model.modelId, preferredRoute?.route.protocol ?? provider.protocol] as const;
  }));
  const overlay = projectModelProtocolOverlays(
    surface?.protocolOverrides ?? [],
    provider.protocol,
    preferredProtocols,
    surface ? observedAt : new Date().toISOString(),
  );
  return {
    providerId: provider.id,
    configurationRevision: providerConnectionRevision(provider),
    accountId: provider.activeAccountId ?? `anonymous:${provider.id}`,
    protocol: provider.protocol,
    catalogOwnership: provider.catalogOwnership,
    discoveryAuthority: surface?.discovery.authority ?? 'additive',
    fallbackRoute: routeFor(provider),
    catalog,
    overlay,
    entitlement: accountBillingEntitlement(provider),
    user: userContribution(provider),
    userOverride: userOverrideContribution(provider),
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
  detail?: string,
  accountIdOverride?: string,
): Promise<EffectiveCatalogSnapshot> {
  const baseRequest = buildEffectiveCatalogRequest(provider);
  const request = accountIdOverride && accountIdOverride !== baseRequest.accountId
    ? { ...baseRequest, accountId: accountIdOverride }
    : baseRequest;
  const projection = getLoadedProviderSurface(provider.id)?.discoveredModelProjection;
  const projectedContributions = (contributions ?? toDiscoveryModelContributions(models)).map((model) => ({
    ...model,
    ...(projection?.fast ? {
      controls: {
        ...model.controls,
        fast: projection.fast,
      },
    } : {}),
    ...(projection?.executionBindings ? {
      executionBindings: projection.executionBindings,
    } : {}),
  }));
  const discovered = applyDiscoveryAuthority(
    provider,
    projectedContributions,
  );
  return effectiveCatalogService.refreshDiscovery(request, async () => ({
    protocol: provider.protocol,
    detail,
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
  providers: ProviderLookup,
): EffectiveModel | null {
  return resolveEffectiveModelSelection(providerId, modelId, providers).model;
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
  // Structural capability resolution must survive an unconfigured account or a
  // not-yet-refreshed entitlement catalog. Only an explicit denial removes the
  // selected model here; RequestPlanner remains the fail-closed availability gate.
  const isStructurallySelectable = (entry: EffectiveModel): boolean => entry.enabled !== false
    && entry.availability !== 'unavailable'
    && entry.selection?.pickerVisibility !== 'internal';
  const exact = snapshot.models.find((entry) => entry.modelId === modelId && isStructurallySelectable(entry));
  const alias = exact
    ? undefined
    : snapshot.models.find((entry) => entry.aliases.includes(modelId) && isStructurallySelectable(entry));
  const model = exact ?? alias ?? null;
  const recommendedOrder = new Map(recommendedModelIds.map((id, index) => [id, index]));
  const recommendations = snapshot.models
    .filter((entry) => entry.modelId !== model?.modelId && isAgentToolExecutableModel(entry))
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
  providers: ProviderLookup,
): EffectiveModelSelection {
  const provider = providers.get(providerId);
  if (!provider) return { requestedModelId: modelId, model: null, recommendations: [] };
  const snapshot = resolveEffectiveCatalog(providerId, providers, modelId);
  if (!snapshot) {
    return { requestedModelId: modelId, model: null, recommendations: [] };
  }
  return selectEffectiveModelFromSnapshot(
    snapshot,
    modelId,
    getLoadedProviderSurface(providerId)?.recommendedModels,
  );
}

export function planEffectiveModelRequest(input: {
  providerId: string;
  modelId: string;
  providers: ProviderLookup;
  controls?: Partial<ConversationTurnControls> & { reasoningLevel?: unknown };
  requestedTemperature?: number;
  compactionThresholdPercent?: number;
}): RequestPlanningResult {
  const snapshot = resolveEffectiveCatalog(input.providerId, input.providers, input.modelId);
  const selection = snapshot
    ? selectEffectiveModelFromSnapshot(
        snapshot,
        input.modelId,
        getLoadedProviderSurface(input.providerId)?.recommendedModels,
      )
    : { requestedModelId: input.modelId, model: null, recommendations: [] };
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
    catalogModels: snapshot?.models,
    controls: input.controls,
    requestedTemperature: input.requestedTemperature,
    compactionThresholdPercent: input.compactionThresholdPercent,
    credentialScopeId: snapshot?.accountId,
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

/** Plans an explicit capability probe against structural capability, bypassing only cached entitlement evidence. */
export function planEffectiveModelCapabilityProbe(input: {
  providerId: string;
  modelId: string;
  mode: LlmModelCapabilityProbeMode;
  providers: ProviderLookup;
  controls: Partial<ConversationTurnControls> & { reasoningLevel?: unknown };
}): RequestPlanningResult {
  const snapshot = resolveEffectiveCatalog(input.providerId, input.providers, input.modelId);
  const selection = snapshot
    ? selectEffectiveModelFromSnapshot(
        snapshot,
        input.modelId,
        getLoadedProviderSurface(input.providerId)?.recommendedModels,
      )
    : null;
  const retryModel = snapshot?.models.find(model => model.modelId === input.modelId && model.enabled && isProbeAvailabilityDenied(model));
  if (!snapshot || (!selection?.model && !retryModel)) return planEffectiveModelRequest(input);

  const selected = structuredClone(selection?.model ?? retryModel!);
  if (isProbeAvailabilityDenied(selected)) selected.availability = 'available';
  const models = snapshot.models.map((candidate) => (
    candidate.modelId === selected.modelId ? selected : structuredClone(candidate)
  ));
  if ((input.mode === 'fast' || input.mode === 'fast-max-context') && selected.controls.fast.state === 'selectable') {
    selected.controls.fast.entitlement = 'granted';
    selected.executionBindings = selected.executionBindings?.map((binding) => (
      binding.when.fast === true ? { ...binding, entitlement: 'granted' as const } : binding
    ));
  }
  if (((input.mode === 'max-context' || input.mode === 'fast-max-context') && selected.controls.maxContext.state === 'selectable') || selected.controls.maxContext.state === 'fixed') {
    selected.controls.maxContext.entitlement = 'granted';
    const maxTierId = selected.controls.maxContext.tierId;
    selected.contextTiers = selected.contextTiers.map((tier) => (
      tier.id === maxTierId ? { ...tier, entitlement: 'granted' as const } : tier
    ));
    selected.executionBindings = selected.executionBindings?.map((binding) => (
      binding.when.maxContext === true ? { ...binding, entitlement: 'granted' as const } : binding
    ));
  }
  return planModelRequest({
    model: selected,
    catalogModels: models,
    controls: input.controls,
    credentialScopeId: snapshot.accountId,
    requireAgentToolEligibility: false,
  });
}
