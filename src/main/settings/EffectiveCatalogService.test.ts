import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectiveCatalogRequest } from './EffectiveCatalogService';

const electronMock = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => electronMock.root },
}));

const route = {
  protocol: 'OpenAICompatibleChatCompletions' as const,
  baseUrl: 'https://example.test/v1',
  source: 'preset' as const,
};

function request(overrides: Partial<EffectiveCatalogRequest> = {}): EffectiveCatalogRequest {
  return {
    providerId: 'provider-a',
    accountId: 'account-a',
    protocol: route.protocol,
    catalogOwnership: 'app-managed',
    fallbackRoute: route,
    seed: {
      source: 'seed',
      observedAt: '2026-01-01T00:00:00.000Z',
      models: [{
        modelId: 'model-a',
        label: 'Seed label',
        availability: 'available',
        contextTiers: [{
          id: 'default',
          label: 'Default',
          maxPromptTokens: 200_000,
          activation: { kind: 'implicit' },
          entitlement: 'granted',
        }],
        fast: { kind: 'unsupported' },
        toolCalling: { state: 'supported' },
      }],
    },
    ...overrides,
  };
}

describe('EffectiveCatalogService', () => {
  let root = '';
  let statePath = '';

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-effective-catalog-'));
    statePath = path.join(root, 'state', 'catalog.json');
    electronMock.root = root;
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('merges every layer by field and records winning field evidence', async () => {
    const { mergeEffectiveCatalog } = await import('./EffectiveCatalogService');
    const [model] = mergeEffectiveCatalog(request({
      discovery: {
        source: 'discovery',
        observedAt: '2026-01-02T00:00:00.000Z',
        models: [{
          modelId: 'model-a',
          label: 'Discovered label',
          contextTiers: [{ id: 'default', maxPromptTokens: 272_000 }],
          visionInput: { state: 'supported' },
        }],
      },
      overlay: {
        source: 'overlay',
        observedAt: '2026-01-03T00:00:00.000Z',
        protocol: route.protocol,
        models: [{ modelId: 'model-a', fixedTemperature: 1 }],
      },
      entitlement: {
        source: 'entitlement',
        observedAt: '2026-01-04T00:00:00.000Z',
        models: [{
          modelId: 'model-a',
          contextTiers: [{ id: 'long', label: 'Long', entitlement: 'unknown', maxPromptTokens: 922_000 }],
        }],
      },
      observed: {
        source: 'observed',
        observedAt: '2026-01-05T00:00:00.000Z',
        models: [{ modelId: 'model-a', structuredOutput: { state: 'unsupported', reason: 'parameter rejected' } }],
      },
      user: {
        source: 'user',
        observedAt: '2026-01-06T00:00:00.000Z',
        models: [{
          modelId: 'model-a',
          defaultBudgetTokens: 128_000,
          route: { baseUrl: 'https://forbidden.test' },
        }],
      },
    }));

    expect(model.label).toBe('Discovered label');
    expect(model.contextTiers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'default', maxPromptTokens: 272_000, entitlement: 'granted' }),
      expect.objectContaining({ id: 'long', maxPromptTokens: 922_000, entitlement: 'unknown' }),
    ]));
    expect(model.defaultBudgetTokens).toBe(128_000);
    expect(model.route.baseUrl).toBe(route.baseUrl);
    expect(model.fixedTemperature).toBe(1);
    expect(model.toolCalling).toEqual({ state: 'supported' });
    expect(model.visionInput).toEqual({ state: 'supported' });
    expect(model.structuredOutput).toMatchObject({ state: 'unsupported' });
    expect(model.provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'label', source: 'discovery' }),
      expect.objectContaining({ field: 'contextTiers.default.maxPromptTokens', source: 'discovery' }),
      expect.objectContaining({ field: 'contextTiers.long.entitlement', source: 'entitlement' }),
      expect.objectContaining({ field: 'structuredOutput.state', source: 'observed' }),
      expect.objectContaining({ field: 'defaultBudgetTokens', source: 'user' }),
    ]));
  });

  it('merges every deterministic optional-layer combination with last present leaf provenance', async () => {
    const { mergeEffectiveCatalog } = await import('./EffectiveCatalogService');
    const layers = [
      ['discovery', 'discovery'],
      ['overlay', 'overlay'],
      ['entitlement', 'entitlement'],
      ['observed', 'observed'],
      ['user', 'user'],
    ] as const;
    for (let mask = 0; mask < 2 ** layers.length; mask += 1) {
      const overrides: Partial<EffectiveCatalogRequest> = {};
      let expectedLabel = 'Seed label';
      let expectedSource = 'seed';
      layers.forEach(([field, source], index) => {
        if ((mask & (1 << index)) === 0) return;
        overrides[field] = {
          source,
          observedAt: `2026-02-0${index + 1}T00:00:00.000Z`,
          models: [{ modelId: 'model-a', label: `${source}-${mask}`, ...(source === 'user' ? { defaultBudgetTokens: 64_000 + mask } : {}) }],
        } as never;
        if (source !== 'user') {
          expectedLabel = `${source}-${mask}`;
          expectedSource = source;
        }
      });
      const [model] = mergeEffectiveCatalog(request(overrides));
      expect(model.label, `mask=${mask}`).toBe(expectedLabel);
      expect(model.provenance.filter((entry) => entry.field === 'label').at(-1), `mask=${mask}`).toMatchObject({
        source: expectedSource,
      });
      expect(model.route.baseUrl, `mask=${mask}`).toBe(route.baseUrl);
      if ((mask & (1 << 4)) !== 0) {
        expect(model.defaultBudgetTokens, `mask=${mask}`).toBe(64_000 + mask);
        expect(model.provenance).toContainEqual(expect.objectContaining({ field: 'defaultBudgetTokens', source: 'user' }));
      }
    }
  });

  it('allows full user-managed overrides', async () => {
    const { mergeEffectiveCatalog } = await import('./EffectiveCatalogService');
    const [model] = mergeEffectiveCatalog(request({
      catalogOwnership: 'user-managed',
      user: {
        source: 'user',
        observedAt: '2026-01-06T00:00:00.000Z',
        models: [{ modelId: 'model-a', route: { baseUrl: 'https://custom.test/v1' } }],
      },
    }));
    expect(model.route.baseUrl).toBe('https://custom.test/v1');
  });

  it('serves stale last-known-good while one refresh runs', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date(nowMs), discoveryTtlMs: 1000 });
    let resolveLoader: ((value: { models: Array<{ modelId: string; label: string }> }) => void) | undefined;
    let calls = 0;
    const loader = () => {
      calls += 1;
      return new Promise<{ models: Array<{ modelId: string; label: string }> }>((resolve) => {
        resolveLoader = resolve;
      });
    };
    const first = service.refreshDiscovery(request(), loader);
    const duplicate = service.refreshDiscovery(request(), loader);
    expect(duplicate).toBe(first);
    resolveLoader?.({ models: [{ modelId: 'model-a', label: 'LKG' }] });
    await first;
    expect(calls).toBe(1);

    nowMs += 2000;
    const stale = service.getSnapshot(request(), async () => ({ models: [{ modelId: 'model-a', label: 'Fresh' }] }));
    expect(stale.stale).toBe(true);
    expect(stale.models[0].label).toBe('LKG');
    await vi.waitFor(() => expect(service.getSnapshot(request()).models[0].label).toBe('Fresh'));
  });

  it('uses the configured production loader for cold and stale SWR reads', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date(nowMs), discoveryTtlMs: 1000 });
    const labels = ['Cold discovery', 'SWR discovery'];
    const loader = vi.fn(async () => ({
      models: [{ modelId: 'model-a', label: labels.shift() ?? 'Unexpected' }],
    }));
    service.setDiscoveryLoaderResolver(() => loader);

    expect(service.getSnapshot(request()).models[0].label).toBe('Seed label');
    await vi.waitFor(() => expect(service.getSnapshot(request()).models[0].label).toBe('Cold discovery'));
    expect(loader).toHaveBeenCalledTimes(1);

    nowMs += 2000;
    expect(service.getSnapshot(request()).models[0].label).toBe('Cold discovery');
    await vi.waitFor(() => expect(service.getSnapshot(request()).models[0].label).toBe('SWR discovery'));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('retains last-known-good after refresh failure and isolates account caches', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date('2026-01-01T00:00:00.000Z') });
    await service.refreshDiscovery(request(), async () => ({ models: [{ modelId: 'model-a', label: 'Account A' }] }));
    await service.refreshDiscovery(request({ accountId: 'account-b' }), async () => ({ models: [{ modelId: 'model-a', label: 'Account B' }] }));
    await service.refreshDiscovery(request(), async () => { throw new Error('offline'); });

    const accountA = service.getSnapshot(request());
    const accountB = service.getSnapshot(request({ accountId: 'account-b' }));
    expect(accountA.models[0].label).toBe('Account A');
    expect(accountA.lastRefreshError).toBe('offline');
    expect(accountB.models[0].label).toBe('Account B');
  });

  it('persists account-scoped observed evidence', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date('2026-01-02T00:00:00.000Z') });
    service.recordObserved(
      { providerId: 'provider-a', accountId: 'account-a', protocol: route.protocol },
      [{ modelId: 'model-a', toolCalling: { state: 'unsupported', reason: 'rejected' } }],
      'real request',
    );
    const reloaded = new EffectiveCatalogService({ statePath, now: () => new Date('2026-01-03T00:00:00.000Z') });
    const [model] = reloaded.getSnapshot(request()).models;
    expect(model.toolCalling).toMatchObject({ state: 'unsupported', reason: 'rejected' });
    expect(model.provenance).toContainEqual(expect.objectContaining({
      field: 'toolCalling.state',
      source: 'observed',
      detail: 'real request',
    }));
  });

  it('publishes observed and quota changes to the latest account/protocol snapshot', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date('2026-07-13T00:00:00.000Z') });
    const snapshots: Array<ReturnType<typeof service.getSnapshot>> = [];
    service.subscribe((snapshot) => snapshots.push(snapshot));
    service.getSnapshot(request());

    service.recordObserved(
      { providerId: 'provider-a', accountId: 'account-a', protocol: route.protocol },
      [{ modelId: 'model-a', visionInput: { state: 'unsupported', reason: 'request rejected' } }],
    );
    expect(snapshots.at(-1)?.models[0].visionInput).toMatchObject({ state: 'unsupported' });

    service.recordTransientQuota(
      { providerId: 'provider-a', accountId: 'account-a', protocol: route.protocol },
      'model-a',
      { exhaustedUntil: '2026-07-13T00:01:00.000Z', note: 'HTTP 429' },
    );
    expect(snapshots.at(-1)?.models[0].quota?.note).toBe('HTTP 429');

    const otherProtocol = service.getSnapshot(request({ protocol: 'AnthropicMessages' }));
    expect(otherProtocol.models[0].quota).toBeUndefined();
  });

  it('invalidates discovery by provider, account, and protocol', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    const service = new EffectiveCatalogService({ statePath });
    await service.refreshDiscovery(request(), async () => ({ models: [{ modelId: 'model-a', label: 'Chat route' }] }));
    await service.refreshDiscovery(request({ protocol: 'AnthropicMessages' }), async () => ({ models: [{ modelId: 'model-a', label: 'Messages route' }] }));

    service.invalidateDiscovery({ providerId: 'provider-a', accountId: 'account-a', protocol: route.protocol });

    expect(service.getSnapshot(request()).models[0].label).toBe('Seed label');
    expect(service.getSnapshot(request({ protocol: 'AnthropicMessages' })).models[0].label).toBe('Messages route');
  });

  it('keeps 429 quota evidence transient and never downgrades capabilities', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    let nowMs = Date.parse('2026-07-13T00:00:00.000Z');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date(nowMs) });
    service.recordTransientQuota(
      { providerId: 'provider-a', accountId: 'account-a', protocol: route.protocol },
      'model-a',
      { exhaustedUntil: '2026-07-13T00:01:00.000Z', note: 'HTTP 429' },
    );

    const throttled = service.getSnapshot(request()).models[0];
    expect(throttled.quota).toEqual({ exhaustedUntil: '2026-07-13T00:01:00.000Z', note: 'HTTP 429' });
    expect(throttled.toolCalling).toEqual({ state: 'supported' });

    const reloaded = new EffectiveCatalogService({ statePath, now: () => new Date(nowMs) });
    expect(reloaded.getSnapshot(request()).models[0].quota).toBeUndefined();

    nowMs += 61_000;
    expect(service.getSnapshot(request()).models[0].quota).toBeUndefined();
  });
});
