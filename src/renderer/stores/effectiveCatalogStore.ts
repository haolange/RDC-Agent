import { getElectronApi } from '../platform/getElectronApi';
import { create } from 'zustand';
import type { EffectiveCatalogSnapshot } from '@shared/types/providerCapability';
import type { LlmProviderEntry, LlmProviderProtocol } from '@shared/types/settings';
import { observeEffectiveCatalog, readEffectiveCatalog } from '../services/effectiveCatalogService';

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

interface CatalogState {
  entries: Record<string, CatalogProjection>;
  load: (scope: CatalogScope, retry?: boolean) => Promise<EffectiveCatalogSnapshot | null>;
  accept: (snapshot: EffectiveCatalogSnapshot) => void;
  invalidate: (scope: CatalogScope) => void;
}

export const useEffectiveCatalogStore = create<CatalogState>((set, get) => ({
  entries: {},
  load: (scope, retry = false) => {
    const key = catalogScopeKey(scope);
    const active = requests.get(key);
    if (active) return active;
    const previous = get().entries[key];
    if (!retry && previous) return Promise.resolve(previous.snapshot);
    const startedAt = generation;
    set((state) => ({ entries: { ...state.entries, [key]: { ...previous, snapshot: previous?.snapshot ?? null, loading: true, error: undefined } } }));
    const request = readEffectiveCatalog(getElectronApi(), scope.id, scope.activeAccountId || `anonymous:${scope.id}`)
      .then((snapshot) => {
        if (!snapshot) throw new Error('The model catalog is unavailable.');
        if (startedAt !== generation || requests.get(key) !== request) return null;
        if (snapshot && (snapshot.providerId !== scope.id
          || snapshot.accountId !== (scope.activeAccountId || `anonymous:${scope.id}`)
          || (snapshot.protocol && snapshot.protocol !== scope.protocol))) {
          throw new Error('The model catalog belongs to a different account or protocol.');
        }
        // A newer event may have arrived while the initial IPC was in flight.
        const current = get().entries[key]?.snapshot;
        const next = current && snapshot && current.generatedAt > snapshot.generatedAt ? current : snapshot;
        set((state) => ({ entries: { ...state.entries, [key]: { snapshot: next, loading: false, error: next.lastRefreshError } } }));
        return next;
      }).catch((error: unknown) => {
        if (startedAt === generation && requests.get(key) === request) {
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
      if (entry.snapshot && entry.snapshot.generatedAt > snapshot.generatedAt) continue;
      set((state) => ({ entries: { ...state.entries, [key]: { snapshot, loading: false, error: snapshot.lastRefreshError } } }));
    }
  },
  invalidate: (scope) => {
    const key = catalogScopeKey(scope);
    requests.delete(key);
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
  configurations.clear();
  useEffectiveCatalogStore.setState({ entries: {} });
}
