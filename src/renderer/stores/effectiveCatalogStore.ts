import { getElectronApi } from '../platform/getElectronApi';
import { create } from 'zustand';
import type { EffectiveCatalogSnapshot } from '@shared/types/providerCapability';
import type { LlmProviderEntry, LlmProviderProtocol } from '@shared/types/settings';
import { observeEffectiveCatalog, readEffectiveCatalog, refreshEffectiveCatalog } from '../services/effectiveCatalogService';
import { latestCatalogProjection } from '../lib/catalogProjection';

export interface CatalogScope {
  id: string;
  activeAccountId?: string;
  protocol: LlmProviderProtocol;
}
export interface CatalogProjection {
  snapshot: EffectiveCatalogSnapshot | null;
  loading: boolean;
  error?: string;
}
const EMPTY: CatalogProjection = { snapshot: null, loading: false };
export const catalogScopeKey = (scope: CatalogScope): string =>
  JSON.stringify([scope.id, scope.activeAccountId || `anonymous:${scope.id}`, scope.protocol]);
const requests = new Map<string, Promise<EffectiveCatalogSnapshot | null>>();
let generation = 0;
const configurations = new Map<string, string>();
const pendingEvents = new Map<string, Map<string, EffectiveCatalogSnapshot>>();

interface CatalogState {
  entries: Record<string, CatalogProjection>;
  load: (scope: CatalogScope, retry?: boolean, revalidate?: boolean) => Promise<EffectiveCatalogSnapshot | null>;
  accept: (snapshot: EffectiveCatalogSnapshot) => void;
  invalidate: (scope: CatalogScope) => void;
}

export const useEffectiveCatalogStore = create<CatalogState>((set, get) => ({
  entries: {},
  load: (scope, retry = false, revalidate = false) => {
    const key = catalogScopeKey(scope);
    const active = requests.get(key);
    if (active) return active;
    const previous = get().entries[key];
    if (!retry && !revalidate && previous) return Promise.resolve(previous.snapshot);
    const startedAt = generation;
    set((state) => ({ entries: { ...state.entries, [key]: { ...previous, snapshot: previous?.snapshot ?? null, loading: true, error: undefined } } }));
    const read = () => readEffectiveCatalog(getElectronApi(), scope.id, scope.activeAccountId || `anonymous:${scope.id}`);
    const request: Promise<EffectiveCatalogSnapshot | null> = (retry ? refreshEffectiveCatalog(getElectronApi(), scope.id).then(() => (
      startedAt === generation && requests.get(key) === request ? read() : null
    )) : read())
      .then((snapshot) => {
        if (startedAt !== generation || requests.get(key) !== request) return null;
        if (!snapshot) throw new Error('The model catalog is unavailable.');
        if (snapshot && (snapshot.providerId !== scope.id
          || snapshot.accountId !== (scope.activeAccountId || `anonymous:${scope.id}`)
          || (snapshot.protocol && snapshot.protocol !== scope.protocol))) {
          throw new Error('The model catalog belongs to a different account or protocol.');
        }
        const current = get().entries[key]?.snapshot;
        const buffered = pendingEvents.get(key)?.get(snapshot.scopeGeneration);
        const next = latestCatalogProjection(current?.scopeGeneration === snapshot.scopeGeneration ? current : null,
          buffered ? latestCatalogProjection(snapshot, buffered) : snapshot);
        pendingEvents.delete(key);
        set((state) => ({ entries: { ...state.entries, [key]: { snapshot: next, loading: false, error: next.lastRefreshError } } }));
        return next;
      }).catch((error: unknown) => {
        if (startedAt === generation && requests.get(key) === request) {
          pendingEvents.delete(key);
          set((state) => ({ entries: { ...state.entries, [key]: {
            snapshot: state.entries[key]?.snapshot ?? null, loading: false,
            error: error instanceof Error ? error.message : 'The model catalog could not be loaded.',
          } } }));
        }
        return null;
      }).finally(() => { if (requests.get(key) === request) requests.delete(key); });
    requests.set(key, request);
    return request;
  },
  accept: (snapshot) => {
    for (const [key, entry] of Object.entries(get().entries)) {
      const [providerId, accountId, protocol] = JSON.parse(key) as string[];
      if (providerId !== snapshot.providerId || accountId !== snapshot.accountId
        || (snapshot.protocol && protocol !== snapshot.protocol)) continue;
      if (!entry.snapshot || entry.snapshot.scopeGeneration !== snapshot.scopeGeneration) {
        if (entry.loading) {
          const buffered = pendingEvents.get(key) ?? new Map<string, EffectiveCatalogSnapshot>();
          buffered.set(snapshot.scopeGeneration, latestCatalogProjection(buffered.get(snapshot.scopeGeneration) ?? null, snapshot));
          pendingEvents.set(key, buffered);
        }
        continue;
      }
      const next = latestCatalogProjection(entry.snapshot, snapshot);
      set((state) => ({ entries: { ...state.entries, [key]: { snapshot: next, loading: entry.loading, error: next.lastRefreshError } } }));
    }
  },
  invalidate: (scope) => {
    const key = catalogScopeKey(scope);
    requests.delete(key);
    pendingEvents.delete(key);
    set((state) => { const entries = { ...state.entries }; delete entries[key]; return { entries }; });
  },
}));

export function readCatalogProjection(scope: CatalogScope): CatalogProjection {
  return useEffectiveCatalogStore.getState().entries[catalogScopeKey(scope)] ?? EMPTY;
}

export function startCatalogProjection(): () => void {
  return observeEffectiveCatalog(getElectronApi(), (snapshot) => useEffectiveCatalogStore.getState().accept(snapshot));
}

/** Settings already owns credential/configuration revision; no secret enters this projection. */
export function reconcileCatalogProviders(providers: readonly LlmProviderEntry[]): void {
  const keys = new Set(providers.map(catalogScopeKey));
  for (const key of Object.keys(useEffectiveCatalogStore.getState().entries)) {
    if (!keys.has(key)) {
      requests.delete(key);
      pendingEvents.delete(key);
      configurations.delete(key);
      useEffectiveCatalogStore.setState((state) => { const entries = { ...state.entries }; delete entries[key]; return { entries }; });
    }
  }
  for (const provider of providers) {
    const key = catalogScopeKey(provider);
    const signature = JSON.stringify([provider.enabled, provider.isConfigured, provider.authMode,
      provider.baseUrl, provider.connectionValues, provider.models]);
    if (configurations.has(key) && configurations.get(key) !== signature) useEffectiveCatalogStore.getState().invalidate(provider);
    configurations.set(key, signature);
    void useEffectiveCatalogStore.getState().load(provider);
  }
}

export function resetCatalogProjection(): void {
  generation += 1;
  requests.clear();
  pendingEvents.clear();
  configurations.clear();
  useEffectiveCatalogStore.setState({ entries: {} });
}
