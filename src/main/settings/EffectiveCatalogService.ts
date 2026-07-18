import fs from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import type {
  CapabilityEvidence,
  CapabilityEvidenceSource,
  CapabilityState,
  ControlDefinition,
  ContextTier,
  EffectiveCatalogSnapshot,
  EffectiveModel,
  ExecutionBindingDefinition,
  ModelRoute,
  ProviderAvailability,
  JsonValue,
} from '@shared/types/providerCapability';
import type {
  LlmProviderCatalogOwnership,
  LlmProviderProtocol,
} from '@shared/types/settings';
import type { ReasoningControl } from '@shared/types/modelCapability';
import { appPathService } from '../runtime/AppPathService';
import { isAdmittedDiscoveredModel, normalizeDiscoveredModelMatchKey } from './DiscoveryAdmission';
import { resolveExecutionBinding, resolveModelControls } from '@shared/utils/modelControls';

export const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;
export const EFFECTIVE_CATALOG_SCHEMA_VERSION = 6 as const;

type PartialContextTier = Partial<ContextTier> & Pick<ContextTier, 'id'>;

export interface CatalogModelContribution {
  modelId: string;
  vendorId?: string;
  label?: string;
  aliases?: string[];
  enabled?: boolean;
  route?: Partial<ModelRoute>;
  routeOptions?: EffectiveModel['routeOptions'];
  preferredRouteOptionId?: string;
  selection?: EffectiveModel['selection'];
  presencePolicy?: EffectiveModel['presencePolicy'];
  availability?: EffectiveModel['availability'];
  unavailableReason?: string;
  contextTiers?: PartialContextTier[];
  defaultBudgetTokens?: number;
  controls?: {
    fast?: ControlDefinition;
    context1m?: ControlDefinition;
    reasoning?: Partial<ReasoningControl>;
  };
  executionBindings?: ExecutionBindingDefinition[];
  toolCalling?: CapabilityState;
  visionInput?: CapabilityState;
  structuredOutput?: CapabilityState;
  fixedTemperature?: number;
  quota?: EffectiveModel['quota'];
  factSource?: {
    sourceKind?: CapabilityEvidence['sourceKind'];
    observedAt?: string;
    refreshedAt?: string;
    sourceRevision?: string;
    sourceHash?: string;
    surface?: string;
    accountScope?: string;
    surfaceBuild?: string;
    plan?: string;
    detail?: string;
  };
  fieldFactSources?: Record<string, NonNullable<CatalogModelContribution['factSource']>>;
}

export interface CatalogLayerContribution {
  source: CapabilityEvidenceSource;
  sourceKind?: CapabilityEvidence['sourceKind'];
  observedAt: string;
  refreshedAt?: string;
  sourceRevision?: string;
  evidenceKey?: string;
  sourceHash?: string;
  surface?: string;
  accountScope?: string;
  surfaceBuild?: string;
  plan?: string;
  expiresAt?: string;
  protocol?: LlmProviderProtocol;
  detail?: string;
  models: CatalogModelContribution[];
}

export interface EffectiveCatalogRequest {
  providerId: string;
  accountId: string;
  protocol?: LlmProviderProtocol;
  catalogOwnership: LlmProviderCatalogOwnership;
  discoveryAuthority: 'authoritative-list' | 'candidate-validation' | 'additive' | 'entitlement-overlay';
  fallbackRoute: ModelRoute;
  catalog: CatalogLayerContribution;
  discovery?: CatalogLayerContribution;
  overlay?: CatalogLayerContribution;
  entitlement?: CatalogLayerContribution;
  observed?: CatalogLayerContribution | CatalogLayerContribution[];
  maintainedSurface?: CatalogLayerContribution;
  user?: CatalogLayerContribution;
  providerAvailability?: ProviderAvailability & { observedAt: string };
}

interface PersistedCatalogState {
  schemaVersion: typeof EFFECTIVE_CATALOG_SCHEMA_VERSION;
  discoveries: Record<string, CatalogLayerContribution>;
  entitlements: Record<string, CatalogLayerContribution>;
  observed: Record<string, CatalogLayerContribution[]>;
}

interface EffectiveCatalogServiceOptions {
  statePath?: string;
  now?: () => Date;
  discoveryTtlMs?: number;
}

interface TransientQuotaEntry {
  quota: NonNullable<EffectiveModel['quota']>;
  observedAt: string;
  protocol?: LlmProviderProtocol;
}

type LoadedCatalogLayer = Omit<CatalogLayerContribution, 'source' | 'observedAt' | 'expiresAt'>;

export interface DiscoveryLoadResult extends LoadedCatalogLayer {
  entitlement?: LoadedCatalogLayer;
}

export type DiscoveryLoader = () => Promise<DiscoveryLoadResult>;
export type DiscoveryLoaderResolver = (request: EffectiveCatalogRequest) => DiscoveryLoader | undefined;
export type DiscoveryLayerNormalizer = (
  request: EffectiveCatalogRequest,
  layer: CatalogLayerContribution,
) => CatalogLayerContribution;
export type EffectiveCatalogListener = (snapshot: EffectiveCatalogSnapshot) => void;

const EMPTY_STATE: PersistedCatalogState = {
  schemaVersion: EFFECTIVE_CATALOG_SCHEMA_VERSION,
  discoveries: {},
  entitlements: {},
  observed: {},
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function revisionFor(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

function routeRevision(route: ModelRoute, optionId?: string): string {
  return revisionFor({ optionId: optionId ?? null, route });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function createUnknownReasoning(): ReasoningControl {
  return {
    kind: 'unknown',
    supportsOff: false,
    levels: [],
    defaultSelection: 'off',
    wireProfile: { kind: 'none' },
  };
}

function createConservativeModel(
  providerId: string,
  modelId: string,
  fallbackRoute: ModelRoute,
  observedAt: string,
): EffectiveModel {
  const evidence = (field: string): CapabilityEvidence => ({
    field,
    source: 'catalog',
    observedAt,
    detail: 'Conservative effective-catalog baseline',
  });
  return {
    providerId,
    modelId,
    label: modelId,
    aliases: [],
    enabled: true,
    route: cloneJson(fallbackRoute),
    routeRevision: routeRevision(fallbackRoute),
    routeOptions: [{
      id: fallbackRoute.protocol,
      route: cloneJson(fallbackRoute),
      routeRevision: routeRevision(fallbackRoute, fallbackRoute.protocol),
      availability: 'available',
    }],
    selection: { pickerVisibility: 'primary' },
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
      fast: { state: 'unknown', defaultValue: false },
      context1m: { state: 'unsupported', fixedValue: false },
      reasoning: createUnknownReasoning(),
    },
    toolCalling: { state: 'unknown' },
    visionInput: { state: 'unknown' },
    structuredOutput: { state: 'unknown' },
    provenance: [
      evidence('providerId'),
      evidence('modelId'),
      evidence('label'),
      evidence('aliases'),
      evidence('enabled'),
      evidence('route.protocol'),
      evidence('route.source'),
      evidence('availability'),
      evidence('contextTiers.default.id'),
      evidence('contextTiers.default.label'),
      evidence('contextTiers.default.activation.kind'),
      evidence('contextTiers.default.entitlement'),
      evidence('defaultBudgetTokens'),
      evidence('controls.fast.state'),
      evidence('controls.context1m.state'),
      evidence('controls.reasoning.kind'),
      evidence('controls.reasoning.supportsOff'),
      evidence('controls.reasoning.levels'),
      evidence('controls.reasoning.defaultSelection'),
      evidence('controls.reasoning.wireProfile.kind'),
      evidence('toolCalling.state'),
      evidence('visionInput.state'),
      evidence('structuredOutput.state'),
    ],
  };
}

function evidenceFor(
  layer: CatalogLayerContribution,
  field: string,
  value?: unknown,
  previous?: unknown,
  previousEvidence?: CapabilityEvidence,
): CapabilityEvidence {
  const evidence: CapabilityEvidence = {
    field,
    source: layer.source,
    sourceKind: layer.sourceKind,
    observedAt: layer.observedAt,
    refreshedAt: layer.refreshedAt,
    sourceRevision: layer.sourceRevision,
    sourceHash: layer.sourceHash,
    surface: layer.surface,
    accountScope: layer.accountScope,
    surfaceBuild: layer.surfaceBuild,
    plan: layer.plan,
    expiresAt: layer.expiresAt,
    protocol: layer.protocol,
    detail: layer.detail,
  };
  if (value !== undefined) evidence.value = cloneJson(value as JsonValue);
  if (previous !== undefined && stableJson(previous) !== stableJson(value)) {
    const previousSource = previousEvidence
      ? `${previousEvidence.source}${previousEvidence.sourceRevision ? `@${previousEvidence.sourceRevision}` : ''}`
      : 'earlier value';
    evidence.conflict = `${previousSource} ${stableJson(previous)} -> ${layer.source} ${stableJson(value)}`;
  }
  return evidence;
}

function layerForField(
  defaultLayer: CatalogLayerContribution,
  fieldLayers: Record<string, CatalogLayerContribution> | undefined,
  field: string,
): CatalogLayerContribution {
  const matchedPath = Object.keys(fieldLayers ?? {})
    .filter((candidate) => field === candidate || field.startsWith(`${candidate}.`))
    .sort((left, right) => right.length - left.length)[0];
  return matchedPath ? fieldLayers?.[matchedPath] ?? defaultLayer : defaultLayer;
}

function mergeObjectLeaves(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
  prefix: string,
  layer: CatalogLayerContribution,
  provenance: CapabilityEvidence[],
  fieldLayers?: Record<string, CatalogLayerContribution>,
): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    const field = prefix ? `${prefix}.${key}` : key;
    const evidenceLayer = layerForField(layer, fieldLayers, field);
    const previous = target[key];
    if (isObject(value)) {
      if (typeof value.kind === 'string' || typeof value.state === 'string') {
        target[key] = cloneJson(value);
        recordObjectLeafEvidence(
          value,
          isObject(previous) ? previous : undefined,
          field,
          layer,
          provenance,
          fieldLayers,
        );
        continue;
      }
      const nextTarget = isObject(target[key]) ? target[key] as Record<string, unknown> : {};
      target[key] = nextTarget;
      mergeObjectLeaves(nextTarget, value, field, layer, provenance, fieldLayers);
      continue;
    }
    target[key] = cloneJson(value);
    provenance.push(evidenceFor(
      evidenceLayer,
      field,
      value,
      previous,
      provenance.filter((entry) => entry.field === field).at(-1),
    ));
  }
}

function recordObjectLeafEvidence(
  value: Record<string, unknown>,
  previous: Record<string, unknown> | undefined,
  prefix: string,
  layer: CatalogLayerContribution,
  provenance: CapabilityEvidence[],
  fieldLayers?: Record<string, CatalogLayerContribution>,
): void {
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue;
    const field = `${prefix}.${key}`;
    if (isObject(child)) {
      recordObjectLeafEvidence(
        child,
        isObject(previous?.[key]) ? previous?.[key] as Record<string, unknown> : undefined,
        field,
        layer,
        provenance,
        fieldLayers,
      );
    } else {
      provenance.push(evidenceFor(
        layerForField(layer, fieldLayers, field),
        field,
        child,
        previous?.[key],
        provenance.filter((entry) => entry.field === field).at(-1),
      ));
    }
  }
}

function mergeContextTiers(
  target: EffectiveModel,
  tiers: PartialContextTier[],
  layer: CatalogLayerContribution,
  fieldLayers?: Record<string, CatalogLayerContribution>,
): void {
  const byId = new Map(target.contextTiers.map((tier) => [tier.id, tier]));
  for (const patch of tiers) {
    const current = byId.get(patch.id) ?? {
      id: patch.id,
      label: patch.label ?? patch.id,
      activation: { kind: 'implicit' } as const,
      entitlement: 'unknown' as const,
    };
    const contextControl = target.controls.context1m;
    const protectsCatalogMaxTier = layer.source === 'entitlement'
      && (contextControl.state === 'fixed' || contextControl.state === 'selectable')
      && contextControl.tierId === patch.id;
    const effectivePatch: PartialContextTier = protectsCatalogMaxTier
      ? {
          id: patch.id,
          ...(patch.entitlement !== undefined ? { entitlement: patch.entitlement } : {}),
        }
      : patch;
    mergeObjectLeaves(
      current as unknown as Record<string, unknown>,
      effectivePatch as unknown as Record<string, unknown>,
      `contextTiers.${patch.id}`,
      layer,
      target.provenance,
      fieldLayers,
    );
    byId.set(patch.id, current as ContextTier);
  }
  target.contextTiers = [...byId.values()];
}

function sanitizeUserContribution(
  layer: CatalogLayerContribution | undefined,
  ownership: LlmProviderCatalogOwnership,
): CatalogLayerContribution | undefined {
  if (!layer || ownership === 'user-managed') {
    return layer;
  }
  return {
    ...layer,
    models: layer.models.map((model) => ({
      modelId: model.modelId,
      enabled: model.enabled,
      preferredRouteOptionId: model.preferredRouteOptionId,
      defaultBudgetTokens: model.defaultBudgetTokens,
      controls: model.controls?.reasoning?.defaultSelection
        ? { reasoning: { defaultSelection: model.controls.reasoning.defaultSelection } }
        : undefined,
    })),
  };
}

function applyLayer(
  models: Map<string, EffectiveModel>,
  request: EffectiveCatalogRequest,
  layer: CatalogLayerContribution | undefined,
): void {
  if (!layer) {
    return;
  }
  const protocolDiffersFromCatalog = Boolean(layer.protocol && layer.protocol !== request.protocol);
  if (protocolDiffersFromCatalog && layer.source !== 'observed') {
    return;
  }
  for (const patch of layer.models) {
    const direct = models.get(patch.modelId);
    const matched = direct ? [patch.modelId, direct] as const : [...models.entries()].find(([, candidate]) => (
      candidate.aliases.includes(patch.modelId)
      || (patch.aliases ?? []).includes(candidate.modelId)
      || (
        layer.source === 'discovery'
        && normalizeDiscoveredModelMatchKey(candidate.modelId) === normalizeDiscoveredModelMatchKey(patch.modelId)
      )
    ));
    const matchedKey = matched?.[0];
    if (!matched && layer.source === 'user' && request.catalogOwnership !== 'user-managed') {
      // Persisted app-managed rows are preferences only. They may update a model
      // admitted by the compiled Catalog or discovery, but must never manufacture members.
      continue;
    }
    if (
      protocolDiffersFromCatalog
      && layer.protocol
      && matched?.[1].route.protocol !== layer.protocol
    ) {
      continue;
    }
    const model = matched?.[1]
      ?? createConservativeModel(request.providerId, patch.modelId, request.fallbackRoute, layer.observedAt);
    const rekeyFromDiscovery = layer.source === 'discovery'
      && matchedKey !== undefined
      && matchedKey !== patch.modelId;
    const {
      aliases,
      contextTiers,
      factSource,
      fieldFactSources,
      modelId: _modelId,
      availability,
      unavailableReason,
      ...ordinaryFields
    } = patch;
    const patchLayer: CatalogLayerContribution = factSource
      ? {
          ...layer,
          ...factSource,
          observedAt: factSource.observedAt ?? layer.observedAt,
        }
      : layer;
    const patchFieldLayers = fieldFactSources
      ? Object.fromEntries(Object.entries(fieldFactSources).map(([fieldPath, metadata]) => [
          fieldPath,
          {
            ...patchLayer,
            ...metadata,
            observedAt: metadata.observedAt ?? patchLayer.observedAt,
          },
        ]))
      : undefined;
    const catalogExplicitlyUnavailable = layer.source !== 'catalog'
      && request.catalog.models.some((catalogModel) => (
        catalogModel.availability === 'unavailable'
        && [catalogModel.modelId, ...(catalogModel.aliases ?? [])]
          .some((id) => normalizeDiscoveredModelMatchKey(id) === normalizeDiscoveredModelMatchKey(model.modelId))
      ));
    const availabilityPatch = catalogExplicitlyUnavailable && availability !== 'unavailable'
      ? {}
      : {
          ...(availability !== undefined ? { availability } : {}),
          ...(unavailableReason !== undefined ? { unavailableReason } : {}),
        };
    const ordinaryPatch = rekeyFromDiscovery
      ? { ...ordinaryFields, ...availabilityPatch }
      : { ...ordinaryFields, ...availabilityPatch, ...(aliases !== undefined ? { aliases } : {}) };
    if (rekeyFromDiscovery) {
      const previousId = model.modelId;
      model.modelId = patch.modelId;
      model.aliases = [...new Set([
        previousId,
        ...model.aliases,
        ...(aliases ?? []),
      ])].filter((alias) => alias !== patch.modelId);
      model.provenance.push(
        evidenceFor(layerForField(patchLayer, patchFieldLayers, 'modelId'), 'modelId', patch.modelId, previousId),
        evidenceFor(layerForField(patchLayer, patchFieldLayers, 'aliases'), 'aliases', model.aliases),
      );
      models.delete(matchedKey);
    }
    mergeObjectLeaves(
      model as unknown as Record<string, unknown>,
      ordinaryPatch as unknown as Record<string, unknown>,
      '',
      patchLayer,
      model.provenance,
      patchFieldLayers,
    );
    if (contextTiers) {
      mergeContextTiers(model, contextTiers, patchLayer, patchFieldLayers);
    }
    if (availability === 'available' && !catalogExplicitlyUnavailable) {
      delete model.unavailableReason;
    }
    models.set(rekeyFromDiscovery || !matchedKey ? patch.modelId : matchedKey, model);
  }
}

function enforceDiscoveryAdmission(
  layer: CatalogLayerContribution | undefined,
): CatalogLayerContribution | undefined {
  if (!layer) return undefined;
  return {
    ...layer,
    models: layer.models.filter((model) => isAdmittedDiscoveredModel({ id: model.modelId })),
  };
}

function sanitizePersistedCatalogState(
  state: PersistedCatalogState,
): { state: PersistedCatalogState; changed: boolean } {
  let changed = false;
  const sanitizeRecord = (
    layers: Record<string, CatalogLayerContribution>,
  ): Record<string, CatalogLayerContribution> => Object.fromEntries(
    Object.entries(layers).map(([key, layer]) => {
      const sanitized = enforceDiscoveryAdmission(layer) ?? layer;
      changed ||= sanitized.models.length !== layer.models.length;
      return [key, sanitized];
    }),
  );
  const sanitizeObserved = (
    layers: Record<string, CatalogLayerContribution[]>,
  ): Record<string, CatalogLayerContribution[]> => Object.fromEntries(
    Object.entries(layers).map(([key, entries]) => [key, entries.map((layer) => {
      const sanitized = enforceDiscoveryAdmission(layer) ?? layer;
      changed ||= sanitized.models.length !== layer.models.length;
      return sanitized;
    })]),
  );
  return {
    state: {
      ...state,
      discoveries: sanitizeRecord(state.discoveries),
      entitlements: sanitizeRecord(state.entitlements),
      observed: sanitizeObserved(state.observed),
    },
    changed,
  };
}

function gateOverlayToExactAdmittedModels(
  overlay: CatalogLayerContribution | undefined,
  discovery: CatalogLayerContribution | undefined,
  catalog: CatalogLayerContribution,
): CatalogLayerContribution | undefined {
  if (!overlay) return undefined;
  const admittedModelIds = new Set(discovery?.models
    .filter((model) => model.availability !== 'unavailable')
    .map((model) => model.modelId) ?? []);
  for (const model of catalog.models) {
    admittedModelIds.add(model.modelId);
  }
  const models = overlay.models.filter((model) => admittedModelIds.has(model.modelId));
  return models.length > 0 ? { ...overlay, models } : undefined;
}

export function mergeEffectiveCatalog(request: EffectiveCatalogRequest): EffectiveModel[] {
  const models = new Map<string, EffectiveModel>();
  const user = sanitizeUserContribution(request.user, request.catalogOwnership);
  const discovery = enforceDiscoveryAdmission(request.discovery);
  const overlay = gateOverlayToExactAdmittedModels(
    request.overlay,
    discovery,
    request.catalog,
  );
  const observedLayers = Array.isArray(request.observed)
    ? request.observed
    : request.observed
      ? [request.observed]
      : [];
  for (const layer of [
    request.catalog,
    discovery,
    overlay,
    request.entitlement,
    ...observedLayers,
    request.maintainedSurface,
    user,
  ]) {
    applyLayer(models, request, layer);
  }
  const projectedModels = [...models.values()].map((model): EffectiveModel => {
    const hasExplicitRouteOptions = model.provenance.some((evidence) => (
      evidence.field === 'routeOptions' || evidence.field.startsWith('routeOptions.')
    ));
    const routeOptions = hasExplicitRouteOptions && model.routeOptions
      ? model.routeOptions.map((option) => ({
          ...cloneJson(option),
          routeRevision: option.routeRevision || routeRevision(option.route, option.id),
        }))
      : [{
          id: model.route.protocol,
          route: cloneJson(model.route),
          routeRevision: routeRevision(model.route, model.route.protocol),
          availability: model.availability,
          ...(model.unavailableReason ? { unavailableReason: model.unavailableReason } : {}),
        }];
    const preferredRouteOption = model.preferredRouteOptionId
      ? routeOptions.find((option) => option.id === model.preferredRouteOptionId)
      : undefined;
    const projectedRoute = preferredRouteOption?.route ?? model.route;
    const projected = {
      ...model,
      aliases: [...model.aliases],
      selection: model.selection ? cloneJson(model.selection) : { pickerVisibility: 'primary' as const },
      presencePolicy: model.presencePolicy ?? 'discovered',
      route: cloneJson(projectedRoute),
      routeRevision: preferredRouteOption?.routeRevision
        ?? (model.preferredRouteOptionId
          ? revisionFor({ preferredRouteOptionId: model.preferredRouteOptionId, routeOptions })
          : routeRevision(model.route)),
      routeOptions,
      contextTiers: model.contextTiers.map((tier) => cloneJson(tier)),
      controls: cloneJson(model.controls),
      executionBindings: model.executionBindings?.map((binding) => cloneJson(binding)),
      provenance: model.provenance.map((evidence) => ({ ...evidence })),
    };
    if (request.providerAvailability?.state === 'unavailable') {
      projected.availability = 'unavailable';
      projected.unavailableReason = request.providerAvailability.reason ?? 'Provider runtime is unavailable.';
      projected.provenance.push({
        field: 'availability',
        source: 'catalog',
        observedAt: request.providerAvailability.observedAt,
        detail: 'Provider runtime availability gate',
      }, {
        field: 'unavailableReason',
        source: 'catalog',
        observedAt: request.providerAvailability.observedAt,
        detail: 'Provider runtime availability gate',
      });
    }
    return projected;
  });
  return projectedModels.map((model) => {
    const bindingResolutions = Object.fromEntries((model.executionBindings ?? []).map((binding) => [
      binding.id,
      resolveExecutionBinding(model, binding, projectedModels),
    ]));
    const revisioned = { ...model, bindingResolutions };
    return {
      ...revisioned,
      resolvedControls: resolveModelControls(revisioned, {
        reasoningLevel: revisioned.controls.reasoning.defaultSelection,
      }, projectedModels).resolved,
    };
  });
}

function cacheKey(providerId: string, accountId: string, protocol?: LlmProviderProtocol): string {
  return `${providerId}\u0000${accountId}\u0000${protocol ?? 'default'}`;
}

function evidenceKey(providerId: string, accountId: string): string {
  return `${providerId}\u0000${accountId}`;
}

export class EffectiveCatalogService {
  private readonly statePath: string;
  private readonly now: () => Date;
  private readonly discoveryTtlMs: number;
  private state: PersistedCatalogState;
  private readonly refreshes = new Map<string, Promise<EffectiveCatalogSnapshot>>();
  private readonly listeners = new Set<EffectiveCatalogListener>();
  private readonly lastErrors = new Map<string, string>();
  private readonly transientQuota = new Map<string, TransientQuotaEntry>();
  private readonly latestRequests = new Map<string, EffectiveCatalogRequest>();
  private discoveryLoaderResolver?: DiscoveryLoaderResolver;
  private discoveryLayerNormalizer?: DiscoveryLayerNormalizer;
  private stateNeedsRewrite = false;

  constructor(options: EffectiveCatalogServiceOptions = {}) {
    this.statePath = options.statePath
      ?? path.join(appPathService.getRuntimePaths().appStateRoot, 'provider-catalog', 'catalog-v4.json');
    this.now = options.now ?? (() => new Date());
    this.discoveryTtlMs = options.discoveryTtlMs ?? DISCOVERY_TTL_MS;
    const persisted = sanitizePersistedCatalogState(this.readState());
    this.state = persisted.state;
    if (persisted.changed || (this.stateNeedsRewrite && options.statePath)) this.persistState();
  }

  subscribe(listener: EffectiveCatalogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setDiscoveryLoaderResolver(resolver?: DiscoveryLoaderResolver): void {
    this.discoveryLoaderResolver = resolver;
  }

  setDiscoveryLayerNormalizer(normalizer?: DiscoveryLayerNormalizer): void {
    this.discoveryLayerNormalizer = normalizer;
  }

  invalidateDiscovery(input: { providerId: string; accountId: string; protocol?: LlmProviderProtocol }): void {
    const exactKey = input.protocol ? cacheKey(input.providerId, input.accountId, input.protocol) : null;
    const prefix = `${input.providerId}\u0000${input.accountId}\u0000`;
    const cachedKeys = new Set([
      ...Object.keys(this.state.discoveries),
      ...Object.keys(this.state.entitlements),
    ]);
    for (const key of cachedKeys) {
      if (key === exactKey || (!exactKey && key.startsWith(prefix))) {
        delete this.state.discoveries[key];
        delete this.state.entitlements[key];
        this.lastErrors.delete(key);
      }
    }
    const observedKey = evidenceKey(input.providerId, input.accountId);
    if (this.state.observed[observedKey]) {
      this.state.observed[observedKey] = this.state.observed[observedKey].filter((layer) => (
        !layer.evidenceKey?.startsWith('capability-probe:')
        || (input.protocol !== undefined && layer.protocol !== input.protocol)
      ));
      if (this.state.observed[observedKey].length === 0) delete this.state.observed[observedKey];
    }
    if (exactKey) this.lastErrors.delete(exactKey);
    this.persistState();
    this.emitLatestSnapshots(input);
  }

  getSnapshot(request: EffectiveCatalogRequest, loader?: DiscoveryLoader): EffectiveCatalogSnapshot {
    const key = cacheKey(request.providerId, request.accountId, request.protocol);
    this.latestRequests.set(key, cloneJson(request));
    const snapshot = this.createSnapshot(request);
    const activeLoader = loader ?? this.discoveryLoaderResolver?.(request);
    if ((!this.resolveDiscovery(request) || snapshot.stale) && activeLoader) {
      void this.refreshDiscovery(request, activeLoader);
    }
    return snapshot;
  }

  private createSnapshot(request: EffectiveCatalogRequest): EffectiveCatalogSnapshot {
    const key = cacheKey(request.providerId, request.accountId, request.protocol);
    const rawDiscovery = request.discovery ?? this.state.discoveries[key];
    const cachedDiscovery = rawDiscovery
      ? this.discoveryLayerNormalizer?.(request, rawDiscovery) ?? rawDiscovery
      : undefined;
    const cachedEntitlement = request.entitlement ?? this.state.entitlements[key];
    const nowMs = this.now().getTime();
    const rawObserved = request.observed ?? this.state.observed[evidenceKey(request.providerId, request.accountId)];
    const persistedObserved = (Array.isArray(rawObserved)
      ? rawObserved
      : rawObserved ? [rawObserved] : [])
      .filter((layer) => (
        !layer.expiresAt || Date.parse(layer.expiresAt) > nowMs
      ));
    const stale = cachedDiscovery?.expiresAt
      ? Date.parse(cachedDiscovery.expiresAt) <= this.now().getTime()
      : Boolean(cachedDiscovery);
    const mergedRequest: EffectiveCatalogRequest = {
      ...request,
      discovery: cachedDiscovery,
      entitlement: cachedEntitlement,
      observed: persistedObserved,
    };
    const mergedModels = mergeEffectiveCatalog(mergedRequest);
    const now = this.now();
    const models = mergedModels.map((model) => {
      const quotaKey = this.quotaKey(request, model.modelId);
      const entry = this.transientQuota.get(quotaKey);
      if (!entry) return model;
      const expiry = entry.quota.exhaustedUntil ? Date.parse(entry.quota.exhaustedUntil) : Number.POSITIVE_INFINITY;
      if (expiry <= now.getTime()) {
        this.transientQuota.delete(quotaKey);
        return model;
      }
      return {
        ...model,
        quota: cloneJson(entry.quota),
        provenance: [
          ...model.provenance,
          {
            field: 'quota',
            source: 'observed' as const,
            observedAt: entry.observedAt,
            expiresAt: entry.quota.exhaustedUntil,
            protocol: entry.protocol,
            detail: entry.quota.note,
          },
        ],
      };
    });
    const catalogRevision = revisionFor({
      providerId: request.providerId,
      accountId: request.accountId,
      protocol: request.protocol ?? null,
      models,
    });
    const revisionedModels = models.map((model) => ({ ...model, catalogRevision }));
    const snapshot: EffectiveCatalogSnapshot = {
      providerId: request.providerId,
      accountId: request.accountId,
      protocol: request.protocol,
      catalogRevision,
      models: revisionedModels,
      generatedAt: now.toISOString(),
      stale,
      refreshing: this.refreshes.has(key),
      lastRefreshError: this.lastErrors.get(key),
    };
    return snapshot;
  }

  refreshDiscovery(request: EffectiveCatalogRequest, loader: DiscoveryLoader): Promise<EffectiveCatalogSnapshot> {
    const key = cacheKey(request.providerId, request.accountId, request.protocol);
    const active = this.refreshes.get(key);
    if (active) {
      return active;
    }
    const refresh = (async () => {
      try {
        const loaded = await loader();
        const observedAt = this.now();
        const expiresAt = new Date(observedAt.getTime() + this.discoveryTtlMs).toISOString();
        const { entitlement, ...discovery } = loaded;
        const loadedDiscovery: CatalogLayerContribution = {
          ...discovery,
          source: 'discovery',
          observedAt: observedAt.toISOString(),
          expiresAt,
        };
        const observedKey = evidenceKey(request.providerId, request.accountId);
        if (this.state.observed[observedKey]) {
          this.state.observed[observedKey] = this.state.observed[observedKey].filter((layer) => (
            layer.protocol !== request.protocol || !layer.evidenceKey?.startsWith('capability-probe:')
          ));
        }
        this.state.discoveries[key] = enforceDiscoveryAdmission(
          this.discoveryLayerNormalizer?.(request, loadedDiscovery) ?? loadedDiscovery,
        ) ?? loadedDiscovery;
        if (entitlement?.models.length) {
          this.state.entitlements[key] = {
            ...entitlement,
            source: 'entitlement',
            observedAt: observedAt.toISOString(),
            expiresAt,
          };
        } else {
          delete this.state.entitlements[key];
        }
        this.lastErrors.delete(key);
        this.persistState();
      } catch (error) {
        this.lastErrors.set(key, error instanceof Error ? error.message : String(error));
      } finally {
        this.refreshes.delete(key);
      }
      const snapshot = this.createSnapshot(request);
      this.emit(snapshot);
      return snapshot;
    })();
    this.refreshes.set(key, refresh);
    return refresh;
  }

  recordObserved(
    request: Pick<EffectiveCatalogRequest, 'providerId' | 'accountId' | 'protocol'>,
    evidenceId: string,
    models: CatalogModelContribution[],
    detail?: string,
    ttlMs?: number,
  ): void {
    const key = evidenceKey(request.providerId, request.accountId);
    const next: CatalogLayerContribution = {
      source: 'observed',
      observedAt: this.now().toISOString(),
      evidenceKey: evidenceId,
      ...(ttlMs ? { expiresAt: new Date(this.now().getTime() + ttlMs).toISOString() } : {}),
      protocol: request.protocol,
      detail,
      models,
    };
    const nowMs = this.now().getTime();
    this.state.observed[key] = [
      ...(this.state.observed[key] ?? []).filter((layer) => (
        (!layer.expiresAt || Date.parse(layer.expiresAt) > nowMs)
        && !(layer.protocol === request.protocol && layer.evidenceKey === evidenceId)
      )),
      next,
    ];
    this.persistState();
    this.emitLatestSnapshots({ providerId: request.providerId, accountId: request.accountId });
  }

  recordTransientQuota(
    request: Pick<EffectiveCatalogRequest, 'providerId' | 'accountId' | 'protocol'>,
    modelId: string,
    quota: NonNullable<EffectiveModel['quota']>,
  ): void {
    this.transientQuota.set(this.quotaKey(request, modelId), {
      quota: cloneJson(quota),
      observedAt: this.now().toISOString(),
      protocol: request.protocol,
    });
    this.emitLatestSnapshots(request);
  }

  private resolveDiscovery(request: EffectiveCatalogRequest): CatalogLayerContribution | undefined {
    return request.discovery ?? this.state.discoveries[cacheKey(request.providerId, request.accountId, request.protocol)];
  }

  private quotaKey(
    request: Pick<EffectiveCatalogRequest, 'providerId' | 'accountId' | 'protocol'>,
    modelId: string,
  ): string {
    return `${cacheKey(request.providerId, request.accountId, request.protocol)}\u0000${modelId}`;
  }

  private emitLatestSnapshots(
    input: Pick<EffectiveCatalogRequest, 'providerId' | 'accountId' | 'protocol'>,
  ): void {
    const exactKey = input.protocol ? cacheKey(input.providerId, input.accountId, input.protocol) : null;
    const prefix = `${input.providerId}\u0000${input.accountId}\u0000`;
    for (const [key, request] of this.latestRequests.entries()) {
      if (key === exactKey || (!exactKey && key.startsWith(prefix))) {
        this.emit(this.createSnapshot(request));
      }
    }
  }

  private emit(snapshot: EffectiveCatalogSnapshot): void {
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // A renderer subscription must not break catalog persistence or other listeners.
      }
    }
  }

  private readState(): PersistedCatalogState {
    try {
      if (!fs.existsSync(this.statePath)) {
        return cloneJson(EMPTY_STATE);
      }
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as Partial<PersistedCatalogState>;
      if (
        parsed.schemaVersion !== EFFECTIVE_CATALOG_SCHEMA_VERSION
        || !isObject(parsed.discoveries)
        || !isObject(parsed.entitlements)
        || !isObject(parsed.observed)
      ) {
        this.stateNeedsRewrite = true;
        return cloneJson(EMPTY_STATE);
      }
      return parsed as PersistedCatalogState;
    } catch {
      return cloneJson(EMPTY_STATE);
    }
  }

  private persistState(): void {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const temporaryPath = `${this.statePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(temporaryPath, this.statePath);
  }
}

export const effectiveCatalogService = new EffectiveCatalogService();
