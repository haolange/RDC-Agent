import { create } from 'zustand';
import { applyEffectiveCatalogChange } from '@shared/utils/effectiveCatalogChange';
import { providerConnectionIdentity } from '@shared/utils/providerConnectionIdentity';
import { getElectronApi } from '../platform/getElectronApi';
import { observeEffectiveCatalog, readEffectiveCatalog, refreshEffectiveCatalog } from '../services/effectiveCatalogService';
import { latestCatalogProjection } from '../lib/catalogProjection';
import { errorDetail } from '../lib/errorDetail';
import type { EffectiveCatalogChange, EffectiveCatalogSnapshot } from '@shared/types/providerCapability';
import type { LlmProviderEntry, LlmProviderProtocol } from '@shared/types/settings';

export interface CatalogScope {
  id: string;
  activeAccountId?: string;
  protocol: LlmProviderProtocol;
}
export interface CatalogProjection {
  snapshot: EffectiveCatalogSnapshot | null;
  loading: boolean;
  /** The technical reason a load failed; surfaces word it themselves and keep this for "Copy details". */
  error?: string;
}
const EMPTY: CatalogProjection = { snapshot: null, loading: false };
const accountOf = (scope: CatalogScope): string => scope.activeAccountId || `anonymous:${scope.id}`;
export const catalogScopeKey = (scope: CatalogScope): string => JSON.stringify([scope.id, accountOf(scope), scope.protocol]);
const requests = new Map<string, Promise<EffectiveCatalogSnapshot | null>>();
let generation = 0;
const scopes = new Map<string, CatalogScope>();
const connections = new Map<string, string>();
/** Changes that arrived while a read was in flight; each applies after the read only to the snapshot it names. */
const pendingChanges = new Map<string, EffectiveCatalogChange[]>();

const changeMatches = (scope: CatalogScope, change: EffectiveCatalogChange): boolean => (
  scope.id === change.snapshot.providerId && accountOf(scope) === change.snapshot.accountId
  && (!change.snapshot.protocol || scope.protocol === change.snapshot.protocol)
);
/** A change for the held configuration that is not newer than the held snapshot tells nothing new. */
const isStale = (current: EffectiveCatalogSnapshot | null, change: EffectiveCatalogChange): boolean => (
  current?.scopeGeneration === change.snapshot.scopeGeneration && current.projectionVersion >= change.snapshot.projectionVersion
);

interface CatalogState {
  entries: Record<string, CatalogProjection>;
  load: (scope: CatalogScope, retry?: boolean, revalidate?: boolean) => Promise<EffectiveCatalogSnapshot | null>;
  /** Applies a catalog change to the snapshot it names; a scope holding another snapshot reads the catalog again. */
  accept: (change: EffectiveCatalogChange) => void;
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
    scopes.set(key, { id: scope.id, activeAccountId: scope.activeAccountId, protocol: scope.protocol });
    const startedAt = generation;
    set((state) => ({ entries: { ...state.entries, [key]: { ...previous, snapshot: previous?.snapshot ?? null, loading: true, error: undefined } } }));
    const read = () => readEffectiveCatalog(getElectronApi(), scope.id, accountOf(scope));
    const request: Promise<EffectiveCatalogSnapshot | null> = (retry ? refreshEffectiveCatalog(getElectronApi(), scope.id, {
      accountId: accountOf(scope), protocol: scope.protocol,
    }).then(() => (
      startedAt === generation && requests.get(key) === request ? read() : null
    )) : read())
      .then((snapshot) => {
        if (startedAt !== generation || requests.get(key) !== request) return null;
        if (!snapshot) throw new Error('The model catalog is unavailable.');
        if (snapshot && (snapshot.providerId !== scope.id
          || snapshot.accountId !== accountOf(scope)
          || (snapshot.protocol && snapshot.protocol !== scope.protocol))) {
          throw new Error('The model catalog belongs to a different account or protocol.');
        }
        const current = get().entries[key]?.snapshot;
        let next = latestCatalogProjection(current?.scopeGeneration === snapshot.scopeGeneration ? current : null, snapshot);
        // A change sent after this read (a transport may deliver it first) names the read's snapshot.
        for (const change of pendingChanges.get(key) ?? []) next = applyEffectiveCatalogChange(next, change) ?? next;
        pendingChanges.delete(key);
        set((state) => ({ entries: { ...state.entries, [key]: { snapshot: next, loading: false, error: next.lastRefreshError } } }));
        return next;
      }).catch((error: unknown) => {
        if (startedAt === generation && requests.get(key) === request) {
          pendingChanges.delete(key);
          set((state) => ({ entries: { ...state.entries, [key]: {
            snapshot: state.entries[key]?.snapshot ?? null, loading: false,
            error: errorDetail(error),
          } } }));
        }
        return null;
      }).finally(() => { if (requests.get(key) === request) requests.delete(key); });
    requests.set(key, request);
    return request;
  },
  accept: (change) => {
    for (const [key, entry] of Object.entries(get().entries)) {
      const scope = scopes.get(key);
      if (!scope || !changeMatches(scope, change)) continue;
      if (entry.loading) {
        pendingChanges.set(key, [...(pendingChanges.get(key) ?? []), change]);
        continue;
      }
      if (isStale(entry.snapshot, change)) continue;
      const next = applyEffectiveCatalogChange(entry.snapshot, change);
      if (next) {
        set((state) => ({ entries: { ...state.entries, [key]: { snapshot: next, loading: false, error: next.lastRefreshError } } }));
      } else {
        void get().load(scope, false, true);
      }
    }
  },
  invalidate: (scope) => {
    const key = catalogScopeKey(scope);
    requests.delete(key);
    pendingChanges.delete(key);
    set((state) => { const entries = { ...state.entries }; delete entries[key]; return { entries }; });
  },
}));

export function readCatalogProjection(scope: CatalogScope): CatalogProjection {
  return useEffectiveCatalogStore.getState().entries[catalogScopeKey(scope)] ?? EMPTY;
}

export function startCatalogProjection(): () => void {
  return observeEffectiveCatalog(getElectronApi(), (change) => useEffectiveCatalogStore.getState().accept(change));
}

/**
 * Settings already owns credential/configuration revision; no secret enters this projection. A new connection
 * discards its catalog; a model choice of the same connection arrives as a catalog change, so it needs no read.
 */
export function reconcileCatalogProviders(
  providers: readonly LlmProviderEntry[],
  activeProviderIds: ReadonlySet<string> = new Set(providers.map((provider) => provider.id)),
): void {
  const keys = new Set(providers.map(catalogScopeKey));
  for (const key of connections.keys()) {
    if (!keys.has(key)) connections.delete(key);
  }
  for (const key of Object.keys(useEffectiveCatalogStore.getState().entries)) {
    if (!keys.has(key)) {
      requests.delete(key);
      pendingChanges.delete(key);
      scopes.delete(key);
      useEffectiveCatalogStore.setState((state) => { const entries = { ...state.entries }; delete entries[key]; return { entries }; });
    }
  }
  for (const provider of providers) {
    const key = catalogScopeKey(provider);
    const connection = providerConnectionIdentity(provider);
    const previous = connections.get(key);
    const store = useEffectiveCatalogStore.getState();
    const tracked = key in store.entries;
    connections.set(key, connection);
    if (previous !== undefined && previous !== connection) store.invalidate(provider);
    if (tracked || activeProviderIds.has(provider.id)) void store.load(provider);
  }
}

export function resetCatalogProjection(): void {
  generation += 1;
  requests.clear();
  pendingChanges.clear();
  scopes.clear();
  connections.clear();
  useEffectiveCatalogStore.setState({ entries: {} });
}
