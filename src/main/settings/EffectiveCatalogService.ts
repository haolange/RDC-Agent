import fs from 'fs';
import path from 'path';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';
import type { LlmProviderProtocol } from '@shared/types/settings';
import { appPathService } from '../runtime/AppPathService';
import {
  cloneJson,
  enforceDiscoveryAdmission,
  isObject,
  mergeEffectiveCatalog,
  revisionFor,
} from './effectiveCatalogMerge';
import {
  DISCOVERY_TTL_MS,
  EFFECTIVE_CATALOG_SCHEMA_VERSION,
  type CatalogLayerContribution,
  type CatalogModelContribution,
  type DiscoveryLayerNormalizer,
  type DiscoveryLoader,
  type DiscoveryLoaderResolver,
  type EffectiveCatalogListener,
  type EffectiveCatalogRequest,
  type EffectiveCatalogServiceOptions,
  type PersistedCatalogState,
  type TransientQuotaEntry,
} from './effectiveCatalogTypes';

const EMPTY_STATE: PersistedCatalogState = {
  schemaVersion: EFFECTIVE_CATALOG_SCHEMA_VERSION,
  discoveries: {},
  entitlements: {},
  observed: {},
};

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
