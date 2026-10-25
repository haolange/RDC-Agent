import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectiveCatalogSnapshot } from '@shared/types/providerCapability';
import { catalogScopeKey, reconcileCatalogProviders, resetCatalogProjection, useEffectiveCatalogStore } from './effectiveCatalogStore';
import type { LlmProviderEntry } from '@shared/types/settings';

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../platform/getElectronApi', () => ({ getElectronApi: () => undefined }));
vi.mock('../services/effectiveCatalogService', () => ({ readEffectiveCatalog: read, observeEffectiveCatalog: () => () => undefined }));
const scope = { id: 'grok-account', activeAccountId: 'a', protocol: 'OpenAIResponses' as const };
const snapshot = (accountId = 'a', generatedAt = '2026-10-25T01:00:00Z'): EffectiveCatalogSnapshot => ({
  providerId: scope.id, accountId, protocol: scope.protocol, catalogRevision: 'revision',
  models: [], generatedAt, stale: false, refreshing: false,
});
const store = () => useEffectiveCatalogStore.getState();
describe('effective catalog projection', () => {
  beforeEach(() => { resetCatalogProjection(); read.mockReset(); });
  it('coalesces requests and reuses snapshots when a menu remounts', async () => {
    let finish!: (value: EffectiveCatalogSnapshot) => void;
    read.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const a = store().load(scope); const b = store().load(scope);
    expect(a).toBe(b); expect(read).toHaveBeenCalledTimes(1);
    finish(snapshot()); await a; await store().load(scope);
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
  it('does not let an initial response replace a newer event', async () => {
    let finish!: (value: EffectiveCatalogSnapshot) => void;
    read.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = store().load(scope);
    store().accept(snapshot('a', '2026-10-25T02:00:00Z'));
    finish(snapshot()); await pending;
    expect(store().entries[catalogScopeKey(scope)].snapshot?.generatedAt).toContain('02:00');
  });
  it('isolates cancelled scopes and mismatched accounts', async () => {
    let finish!: (value: EffectiveCatalogSnapshot) => void;
    read.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = store().load(scope); store().invalidate(scope);
    finish(snapshot()); await pending; store().accept(snapshot());
    expect(store().entries[catalogScopeKey(scope)]).toBeUndefined();
    read.mockResolvedValueOnce(snapshot('other'));
    await store().load(scope);
    expect(store().entries[catalogScopeKey(scope)].error).toContain('different account');
    expect(store().entries[catalogScopeKey(scope)].snapshot).toBeNull();
  });
  it('retains usable rows during failed refresh and supports explicit retry', async () => {
    read.mockResolvedValueOnce(snapshot()).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(snapshot());
    await store().load(scope); await store().load(scope, true);
    expect(store().entries[catalogScopeKey(scope)]).toMatchObject({ snapshot: snapshot(), error: 'offline', loading: false });
    await store().load(scope, true);
    expect(store().entries[catalogScopeKey(scope)].error).toBeUndefined();
  });
  it('refreshes changed route preferences without reloading for identical settings', async () => {
    read.mockResolvedValue(snapshot());
    const provider = { ...scope, enabled: true, isConfigured: true, models: [
      { id: 'grok-4.7', enabled: true, preferredRouteOptionId: 'responses' },
    ] } as LlmProviderEntry;
    reconcileCatalogProviders([provider]); await store().load(scope);
    reconcileCatalogProviders([{ ...provider, models: [...provider.models], lastTestedAt: '2026-10-25T03:00:00Z' }]); await store().load(scope);
    expect(read).toHaveBeenCalledTimes(1);
    reconcileCatalogProviders([{ ...provider, models: [{ ...provider.models[0], preferredRouteOptionId: 'chat' }] }]);
    await store().load(scope);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('exposes a main-process refresh failure while retaining its cached catalog', async () => {
    read.mockResolvedValue({ ...snapshot(), lastRefreshError: 'HTTP 401' });
    await store().load(scope);
    expect(store().entries[catalogScopeKey(scope)]).toMatchObject({ error: 'HTTP 401', loading: false });
    expect(store().entries[catalogScopeKey(scope)].snapshot).not.toBeNull();
  });
});
