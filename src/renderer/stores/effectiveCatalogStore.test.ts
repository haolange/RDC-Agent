import { beforeEach, describe, expect, it, vi } from 'vitest';
import { diffEffectiveCatalog } from '@shared/utils/effectiveCatalogChange';
import {
  catalogScopeKey,
  reconcileCatalogProviders,
  resetCatalogProjection,
  useEffectiveCatalogStore,
} from './effectiveCatalogStore';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';
import type { LlmProviderEntry } from '@shared/types/settings';

const { read, refresh } = vi.hoisted(() => ({ read: vi.fn(), refresh: vi.fn() }));
vi.mock('../platform/getElectronApi', () => ({ getElectronApi: () => undefined }));
vi.mock('../services/effectiveCatalogService', () => ({
  readEffectiveCatalog: read,
  refreshEffectiveCatalog: refresh,
  observeEffectiveCatalog: () => () => undefined,
}));
const scope = { id: 'grok-account', activeAccountId: 'a', protocol: 'OpenAIResponses' as const };
const snapshot = (accountId = 'a', generatedAt = '2026-10-25T01:00:00Z'): EffectiveCatalogSnapshot => ({
  scopeGeneration: 'scope-a',
  projectionVersion: Date.parse(generatedAt),
  providerId: scope.id,
  accountId,
  protocol: scope.protocol,
  catalogRevision: 'revision',
  models: [],
  generatedAt,
  stale: false,
  refreshing: false,
});
const store = () => useEffectiveCatalogStore.getState();
const model = (modelId: string): EffectiveModel =>
  ({ modelId, label: modelId, catalogRevision: 'revision' }) as EffectiveModel;
describe('effective catalog projection', () => {
  it('applies a change to the snapshot it names and rereads when it names another', async () => {
    const held = { ...snapshot(), projectionVersion: 1, models: [model('a')] };
    read.mockResolvedValueOnce(held);
    await store().load(scope);
    const next = { ...held, projectionVersion: 2, catalogRevision: 'next', models: [model('a'), model('b')] };
    store().accept(diffEffectiveCatalog(held, next));
    expect(store().entries[catalogScopeKey(scope)].snapshot).toEqual({
      ...next,
      models: next.models.map((entry) => ({ ...entry, catalogRevision: 'next' })),
    });
    expect(read).toHaveBeenCalledTimes(1);

    read.mockResolvedValueOnce({ ...next, projectionVersion: 4 });
    store().accept(diffEffectiveCatalog({ ...held, projectionVersion: 3 }, { ...next, projectionVersion: 4 }));
    await store().load(scope);
    expect(read).toHaveBeenCalledTimes(2);
    expect(store().entries[catalogScopeKey(scope)].snapshot?.projectionVersion).toBe(4);
  });
  it('ignores a change that is not newer than the held snapshot and one for another account', async () => {
    const held = { ...snapshot(), projectionVersion: 5 };
    read.mockResolvedValueOnce(held);
    await store().load(scope);
    store().accept(diffEffectiveCatalog({ ...held, projectionVersion: 3 }, { ...held, projectionVersion: 4 }));
    store().accept(diffEffectiveCatalog(null, { ...snapshot('other'), projectionVersion: 9 }));
    expect(store().entries[catalogScopeKey(scope)].snapshot).toBe(held);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('applies a change that names the snapshot a pending read returns, even when it arrives first', async () => {
    let finish!: (value: EffectiveCatalogSnapshot) => void;
    read.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = store().load(scope);
    const response = { ...snapshot(), projectionVersion: 1, models: [model('a')] };
    const later = { ...response, projectionVersion: 2, catalogRevision: 'later', models: [model('a'), model('b')] };
    store().accept(diffEffectiveCatalog({ ...response, projectionVersion: 0 }, { ...response, projectionVersion: 1 }));
    store().accept(diffEffectiveCatalog(response, later));
    finish(response);
    await pending;
    expect(store().entries[catalogScopeKey(scope)].snapshot?.catalogRevision).toBe('later');
    expect(store().entries[catalogScopeKey(scope)].snapshot?.models.map((entry) => entry.modelId)).toEqual(['a', 'b']);
  });
  beforeEach(() => {
    resetCatalogProjection();
    read.mockReset();
    refresh.mockReset().mockResolvedValue(undefined);
  });
  it('explicit retry refreshes the provider directory instead of rereading the same rejected snapshot', async () => {
    read
      .mockResolvedValueOnce({ ...snapshot(), projectionVersion: 0, lastRefreshError: 'HTTP 401' })
      .mockResolvedValueOnce(snapshot());
    await store().load(scope);
    const first = store().load(scope, true);
    const duplicate = store().load(scope, true);
    expect(first).toBe(duplicate);
    await first;
    expect(refresh).toHaveBeenCalledExactlyOnceWith(undefined, 'grok-account', {
      accountId: 'a',
      protocol: 'OpenAIResponses',
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(store().entries[catalogScopeKey(scope)].error).toBeUndefined();
  });
  it('coalesces requests and reuses snapshots when a menu remounts', async () => {
    let finish!: (value: EffectiveCatalogSnapshot) => void;
    read.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const a = store().load(scope);
    const b = store().load(scope);
    expect(a).toBe(b);
    expect(read).toHaveBeenCalledTimes(1);
    finish(snapshot());
    await a;
    await store().load(scope);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('publishes a fast provider while another provider is still pending', async () => {
    read.mockResolvedValueOnce(snapshot()).mockReturnValueOnce(new Promise(() => undefined));
    const first = store().load(scope);
    void store().load({ ...scope, id: 'slow' });
    await first;
    expect(store().entries[catalogScopeKey(scope)].snapshot).not.toBeNull();
    expect(store().entries[catalogScopeKey({ ...scope, id: 'slow' })].loading).toBe(true);
  });
  it('isolates cancelled scopes and mismatched accounts', async () => {
    let finish!: (value: EffectiveCatalogSnapshot) => void;
    read.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = store().load(scope);
    store().invalidate(scope);
    finish(snapshot());
    await pending;
    store().accept(diffEffectiveCatalog(null, snapshot()));
    expect(store().entries[catalogScopeKey(scope)]).toBeUndefined();
    read.mockResolvedValueOnce(snapshot('other'));
    await store().load(scope);
    expect(store().entries[catalogScopeKey(scope)].error).toContain('different account');
    expect(store().entries[catalogScopeKey(scope)].snapshot).toBeNull();
  });
  it('retains usable rows during failed refresh and supports explicit retry', async () => {
    read
      .mockResolvedValueOnce(snapshot())
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(snapshot());
    await store().load(scope);
    await store().load(scope, true);
    expect(store().entries[catalogScopeKey(scope)]).toMatchObject({
      snapshot: snapshot(),
      error: 'offline',
      loading: false,
    });
    await store().load(scope, true);
    expect(store().entries[catalogScopeKey(scope)].error).toBeUndefined();
  });
  it('reads nothing for a model choice of the same connection and discards the catalog for a new endpoint', async () => {
    const initial = snapshot();
    read.mockResolvedValueOnce(initial);
    const provider = {
      ...scope,
      enabled: true,
      isConfigured: true,
      baseUrl: 'https://example.test',
      models: [{ id: 'model-a', enabled: true, preferredRouteOptionId: 'responses' }],
    } as LlmProviderEntry;
    const key = catalogScopeKey(provider);
    reconcileCatalogProviders([provider]);
    await store().load(scope);

    // The model choice arrives as a catalog change; settings only carry the new rows.
    const disabled = {
      ...provider,
      enabled: false,
      models: [{ ...provider.models[0], enabled: false, preferredRouteOptionId: 'chat' }],
    };
    reconcileCatalogProviders([disabled], new Set());
    await store().load(scope);
    expect(read).toHaveBeenCalledTimes(1);
    expect(store().entries[key].snapshot).toBe(initial);

    read.mockResolvedValueOnce({ ...initial, scopeGeneration: 'new-endpoint' });
    reconcileCatalogProviders([{ ...disabled, baseUrl: 'https://second.test' }], new Set());
    expect(store().entries[key].snapshot).toBeNull();
    await store().load(scope);
    expect(store().entries[key].snapshot?.scopeGeneration).toBe('new-endpoint');
  });
  it('exposes a main-process refresh failure while retaining its cached catalog', async () => {
    read.mockResolvedValue({ ...snapshot(), projectionVersion: 0, lastRefreshError: 'HTTP 401' });
    await store().load(scope);
    expect(store().entries[catalogScopeKey(scope)]).toMatchObject({ error: 'HTTP 401', loading: false });
    expect(store().entries[catalogScopeKey(scope)].snapshot).not.toBeNull();
  });
});
