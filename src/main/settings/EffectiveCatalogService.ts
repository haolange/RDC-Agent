import fs from 'fs';
import path from 'path';
import type {
  CapabilityEvidence,
  CapabilityEvidenceSource,
  CapabilityState,
  ContextTier,
  EffectiveCatalogSnapshot,
  EffectiveModel,
  FastCapability,
  ModelRoute,
  ProviderAvailability,
} from '@shared/types/providerCapability';
import type {
  LlmProviderCatalogOwnership,
  LlmProviderProtocol,
} from '@shared/types/settings';
import type { ReasoningControl } from '@shared/types/modelCapability';
import { appPathService } from '../runtime/AppPathService';
import { isAdmittedDiscoveredModel, normalizeDiscoveredModelMatchKey } from './DiscoveryAdmission';

export const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;

type PartialContextTier = Partial<ContextTier> & Pick<ContextTier, 'id'>;

export interface CatalogModelContribution {
  modelId: string;
  vendorId?: string;
  label?: string;
  aliases?: string[];
  enabled?: boolean;
  route?: Partial<ModelRoute>;
  availability?: EffectiveModel['availability'];
  unavailableReason?: string;
  contextTiers?: PartialContextTier[];
  defaultBudgetTokens?: number;
  fast?: FastCapability;
  reasoning?: Partial<ReasoningControl>;
  toolCalling?: CapabilityState;
  visionInput?: CapabilityState;
  structuredOutput?: CapabilityState;
  fixedTemperature?: number;
  quota?: EffectiveModel['quota'];
  constraints?: EffectiveModel['constraints'];
}

export interface CatalogLayerContribution {
  source: CapabilityEvidenceSource;
  observedAt: string;
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
  fallbackRoute: ModelRoute;
  seed: CatalogLayerContribution;
  discovery?: CatalogLayerContribution;
  overlay?: CatalogLayerContribution;
  entitlement?: CatalogLayerContribution;
  observed?: CatalogLayerContribution | CatalogLayerContribution[];
  user?: CatalogLayerContribution;
  providerAvailability?: ProviderAvailability & { observedAt: string };
}

interface PersistedCatalogState {
  schemaVersion: 2;
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
  schemaVersion: 2,
  discoveries: {},
  entitlements: {},
  observed: {},
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
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
    source: 'seed',
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
    availability: 'unknown',
    contextTiers: [{
      id: 'default',
      label: 'Default',
      activation: { kind: 'implicit' },
      entitlement: 'unknown',
    }],
    defaultBudgetTokens: 256_000,
    fast: { kind: 'unknown' },
    reasoning: createUnknownReasoning(),
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
      evidence('fast.kind'),
      evidence('reasoning.kind'),
      evidence('reasoning.supportsOff'),
      evidence('reasoning.levels'),
      evidence('reasoning.defaultSelection'),
      evidence('reasoning.wireProfile.kind'),
      evidence('toolCalling.state'),
      evidence('visionInput.state'),
      evidence('structuredOutput.state'),
    ],
  };
}

function evidenceFor(
  layer: CatalogLayerContribution,
  field: string,
): CapabilityEvidence {
  return {
    field,
    source: layer.source,
    observedAt: layer.observedAt,
    expiresAt: layer.expiresAt,
    protocol: layer.protocol,
    detail: layer.detail,
  };
}

function mergeObjectLeaves(
  target: Record<string, unknown>,
  patch: Record<string, unknown>,
  prefix: string,
  layer: CatalogLayerContribution,
  provenance: CapabilityEvidence[],
): void {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      continue;
    }
    const field = prefix ? `${prefix}.${key}` : key;
    if (isObject(value)) {
      if (typeof value.kind === 'string') {
        target[key] = cloneJson(value);
        recordObjectLeafEvidence(value, field, layer, provenance);
        continue;
      }
      const nextTarget = isObject(target[key]) ? target[key] as Record<string, unknown> : {};
      target[key] = nextTarget;
      mergeObjectLeaves(nextTarget, value, field, layer, provenance);
      continue;
    }
    target[key] = cloneJson(value);
    provenance.push(evidenceFor(layer, field));
  }
}

function recordObjectLeafEvidence(
  value: Record<string, unknown>,
  prefix: string,
  layer: CatalogLayerContribution,
  provenance: CapabilityEvidence[],
): void {
  for (const [key, child] of Object.entries(value)) {
    if (child === undefined) continue;
    const field = `${prefix}.${key}`;
    if (isObject(child)) {
      recordObjectLeafEvidence(child, field, layer, provenance);
    } else {
      provenance.push(evidenceFor(layer, field));
    }
  }
}

function mergeContextTiers(
  target: EffectiveModel,
  tiers: PartialContextTier[],
  layer: CatalogLayerContribution,
): void {
  const byId = new Map(target.contextTiers.map((tier) => [tier.id, tier]));
  for (const patch of tiers) {
    const current = byId.get(patch.id) ?? {
      id: patch.id,
      label: patch.label ?? patch.id,
      activation: { kind: 'implicit' } as const,
      entitlement: 'unknown' as const,
    };
    mergeObjectLeaves(
      current as unknown as Record<string, unknown>,
      patch as unknown as Record<string, unknown>,
      `contextTiers.${patch.id}`,
      layer,
      target.provenance,
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
      defaultBudgetTokens: model.defaultBudgetTokens,
      reasoning: model.reasoning?.defaultSelection
        ? { defaultSelection: model.reasoning.defaultSelection }
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
        && request.catalogOwnership === 'app-managed'
        && normalizeDiscoveredModelMatchKey(candidate.modelId) === normalizeDiscoveredModelMatchKey(patch.modelId)
      )
    ));
    const matchedKey = matched?.[0];
    if (!matched && layer.source === 'user' && request.catalogOwnership === 'app-managed') {
      // Persisted app-managed rows are preferences only. They may update a model
      // admitted by seed/discovery, but must never manufacture catalog members.
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
    const { aliases, contextTiers, modelId: _modelId, ...ordinaryFields } = patch;
    const ordinaryPatch = rekeyFromDiscovery
      ? ordinaryFields
      : { ...ordinaryFields, ...(aliases !== undefined ? { aliases } : {}) };
    if (rekeyFromDiscovery) {
      const previousId = model.modelId;
      model.modelId = patch.modelId;
      model.aliases = [...new Set([
        previousId,
        ...model.aliases,
        ...(aliases ?? []),
      ])].filter((alias) => alias !== patch.modelId);
      model.provenance.push(
        evidenceFor(layer, 'modelId'),
        evidenceFor(layer, 'aliases'),
      );
      models.delete(matchedKey);
    }
    mergeObjectLeaves(
      model as unknown as Record<string, unknown>,
      ordinaryPatch as unknown as Record<string, unknown>,
      '',
      layer,
      model.provenance,
    );
    if (contextTiers) {
      mergeContextTiers(model, contextTiers, layer);
    }
    if (patch.availability === 'available') {
      delete model.unavailableReason;
    }
    models.set(rekeyFromDiscovery || !matchedKey ? patch.modelId : matchedKey, model);
  }
}

function suppressAliasedDiscoveryTombstones(
  layer: CatalogLayerContribution | undefined,
): CatalogLayerContribution | undefined {
  if (!layer || layer.source !== 'discovery') return layer;
  const liveKeys = new Set(layer.models
    .filter((model) => model.availability !== 'unavailable')
    .map((model) => normalizeDiscoveredModelMatchKey(model.modelId)));
  return {
    ...layer,
    models: layer.models.filter((model) => !(
      model.availability === 'unavailable'
      && model.unavailableReason === 'This model was not returned by the latest successful provider discovery.'
      && liveKeys.has(normalizeDiscoveredModelMatchKey(model.modelId))
    )),
  };
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

function gateOverlayToLiveExactModels(
  overlay: CatalogLayerContribution | undefined,
  discovery: CatalogLayerContribution | undefined,
): CatalogLayerContribution | undefined {
  if (!overlay || !discovery) return undefined;
  const liveModelIds = new Set(discovery.models
    .filter((model) => model.availability !== 'unavailable')
    .map((model) => model.modelId));
  const models = overlay.models.filter((model) => liveModelIds.has(model.modelId));
  return models.length > 0 ? { ...overlay, models } : undefined;
}

export function mergeEffectiveCatalog(request: EffectiveCatalogRequest): EffectiveModel[] {
  const models = new Map<string, EffectiveModel>();
  const user = sanitizeUserContribution(request.user, request.catalogOwnership);
  const discovery = suppressAliasedDiscoveryTombstones(enforceDiscoveryAdmission(request.discovery));
  const overlay = gateOverlayToLiveExactModels(request.overlay, discovery);
  const observedLayers = Array.isArray(request.observed)
    ? request.observed
    : request.observed
      ? [request.observed]
      : [];
  for (const layer of [
    request.seed,
    discovery,
    overlay,
    request.entitlement,
    ...observedLayers,
    user,
  ]) {
    applyLayer(models, request, layer);
  }
  return [...models.values()].map((model) => {
    const projected = {
      ...model,
      aliases: [...model.aliases],
      contextTiers: model.contextTiers.map((tier) => cloneJson(tier)),
      provenance: model.provenance.map((evidence) => ({ ...evidence })),
    };
    if (request.providerAvailability?.state === 'unavailable') {
      projected.availability = 'unavailable';
      projected.unavailableReason = request.providerAvailability.reason ?? 'Provider runtime is unavailable.';
      projected.provenance.push({
        field: 'availability',
        source: 'seed',
        observedAt: request.providerAvailability.observedAt,
        detail: 'Provider runtime availability gate',
      }, {
        field: 'unavailableReason',
        source: 'seed',
        observedAt: request.providerAvailability.observedAt,
        detail: 'Provider runtime availability gate',
      });
    }
    return projected;
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

  constructor(options: EffectiveCatalogServiceOptions = {}) {
    this.statePath = options.statePath
      ?? path.join(appPathService.getRuntimePaths().appStateRoot, 'provider-catalog', 'catalog-v2.json');
    this.now = options.now ?? (() => new Date());
    this.discoveryTtlMs = options.discoveryTtlMs ?? DISCOVERY_TTL_MS;
    const persisted = sanitizePersistedCatalogState(this.readState());
    this.state = persisted.state;
    if (persisted.changed) this.persistState();
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
    const persistedObserved = request.observed ?? this.state.observed[evidenceKey(request.providerId, request.accountId)];
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
    const snapshot: EffectiveCatalogSnapshot = {
      providerId: request.providerId,
      accountId: request.accountId,
      protocol: request.protocol,
      models,
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

  recordObserved(request: Pick<EffectiveCatalogRequest, 'providerId' | 'accountId' | 'protocol'>, models: CatalogModelContribution[], detail?: string): void {
    const key = evidenceKey(request.providerId, request.accountId);
    const next: CatalogLayerContribution = {
      source: 'observed',
      observedAt: this.now().toISOString(),
      protocol: request.protocol,
      detail,
      models,
    };
    this.state.observed[key] = [...(this.state.observed[key] ?? []), next];
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
        parsed.schemaVersion !== 2
        || !isObject(parsed.discoveries)
        || !isObject(parsed.entitlements)
        || !isObject(parsed.observed)
      ) {
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
