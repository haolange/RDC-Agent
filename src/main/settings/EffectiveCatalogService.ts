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
} from '@shared/types/providerCapability';
import type {
  LlmProviderCatalogOwnership,
  LlmProviderProtocol,
} from '@shared/types/settings';
import type { ReasoningControl } from '@shared/types/modelCapability';
import { appPathService } from '../runtime/AppPathService';

export const DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;

type PartialContextTier = Partial<ContextTier> & Pick<ContextTier, 'id'>;

export interface CatalogModelContribution {
  modelId: string;
  vendorId?: string;
  label?: string;
  aliases?: string[];
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
}

interface PersistedCatalogState {
  schemaVersion: 1;
  discoveries: Record<string, CatalogLayerContribution>;
  observed: Record<string, CatalogLayerContribution[]>;
}

interface EffectiveCatalogServiceOptions {
  statePath?: string;
  now?: () => Date;
  discoveryTtlMs?: number;
}

export type DiscoveryLoader = () => Promise<Omit<CatalogLayerContribution, 'source' | 'observedAt' | 'expiresAt'>>;
export type EffectiveCatalogListener = (snapshot: EffectiveCatalogSnapshot) => void;

const EMPTY_STATE: PersistedCatalogState = {
  schemaVersion: 1,
  discoveries: {},
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
    kind: 'none',
    supportsOff: true,
    levels: [],
    defaultSelection: 'off',
    lockedSelection: 'off',
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
      evidence('reasoning.lockedSelection'),
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
      const nextTarget = isObject(target[key]) ? target[key] as Record<string, unknown> : {};
      target[key] = nextTarget;
      mergeObjectLeaves(nextTarget, value, field, layer, provenance);
      continue;
    }
    target[key] = cloneJson(value);
    provenance.push(evidenceFor(layer, field));
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
  if (!layer || (layer.protocol && layer.protocol !== request.protocol)) {
    return;
  }
  for (const patch of layer.models) {
    const model = models.get(patch.modelId)
      ?? createConservativeModel(request.providerId, patch.modelId, request.fallbackRoute, layer.observedAt);
    const { contextTiers, modelId: _modelId, ...ordinaryPatch } = patch;
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
    models.set(patch.modelId, model);
  }
}

export function mergeEffectiveCatalog(request: EffectiveCatalogRequest): EffectiveModel[] {
  const models = new Map<string, EffectiveModel>();
  const user = sanitizeUserContribution(request.user, request.catalogOwnership);
  const observedLayers = Array.isArray(request.observed)
    ? request.observed
    : request.observed
      ? [request.observed]
      : [];
  for (const layer of [
    request.seed,
    request.discovery,
    request.overlay,
    request.entitlement,
    ...observedLayers,
    user,
  ]) {
    applyLayer(models, request, layer);
  }
  return [...models.values()].map((model) => ({
    ...model,
    aliases: [...model.aliases],
    contextTiers: model.contextTiers.map((tier) => cloneJson(tier)),
    provenance: model.provenance.map((evidence) => ({ ...evidence })),
  }));
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

  constructor(options: EffectiveCatalogServiceOptions = {}) {
    this.statePath = options.statePath
      ?? path.join(appPathService.getRuntimePaths().appStateRoot, 'provider-catalog', 'catalog-v1.json');
    this.now = options.now ?? (() => new Date());
    this.discoveryTtlMs = options.discoveryTtlMs ?? DISCOVERY_TTL_MS;
    this.state = this.readState();
  }

  subscribe(listener: EffectiveCatalogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(request: EffectiveCatalogRequest, loader?: DiscoveryLoader): EffectiveCatalogSnapshot {
    const key = cacheKey(request.providerId, request.accountId, request.protocol);
    const cachedDiscovery = request.discovery ?? this.state.discoveries[key];
    const persistedObserved = request.observed ?? this.state.observed[evidenceKey(request.providerId, request.accountId)];
    const stale = cachedDiscovery?.expiresAt
      ? Date.parse(cachedDiscovery.expiresAt) <= this.now().getTime()
      : Boolean(cachedDiscovery);
    const mergedRequest: EffectiveCatalogRequest = {
      ...request,
      discovery: cachedDiscovery,
      observed: persistedObserved,
    };
    const snapshot: EffectiveCatalogSnapshot = {
      providerId: request.providerId,
      accountId: request.accountId,
      protocol: request.protocol,
      models: mergeEffectiveCatalog(mergedRequest),
      generatedAt: this.now().toISOString(),
      stale,
      refreshing: this.refreshes.has(key),
      lastRefreshError: this.lastErrors.get(key),
    };
    if ((!cachedDiscovery || stale) && loader) {
      void this.refreshDiscovery(request, loader);
    }
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
        this.state.discoveries[key] = {
          ...loaded,
          source: 'discovery',
          observedAt: observedAt.toISOString(),
          expiresAt: new Date(observedAt.getTime() + this.discoveryTtlMs).toISOString(),
        };
        this.lastErrors.delete(key);
        this.persistState();
      } catch (error) {
        this.lastErrors.set(key, error instanceof Error ? error.message : String(error));
      } finally {
        this.refreshes.delete(key);
      }
      const snapshot = this.getSnapshot(request);
      for (const listener of this.listeners) {
        listener(snapshot);
      }
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
  }

  private readState(): PersistedCatalogState {
    try {
      if (!fs.existsSync(this.statePath)) {
        return cloneJson(EMPTY_STATE);
      }
      const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as Partial<PersistedCatalogState>;
      if (parsed.schemaVersion !== 1 || !isObject(parsed.discoveries) || !isObject(parsed.observed)) {
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
