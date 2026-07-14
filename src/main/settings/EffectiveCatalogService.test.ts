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

  it('replaces discriminated capability unions atomically across kinds', async () => {
    const { mergeEffectiveCatalog } = await import('./EffectiveCatalogService');
    const [model] = mergeEffectiveCatalog(request({
      discovery: {
        source: 'discovery',
        observedAt: '2026-01-02T00:00:00.000Z',
        models: [{
          modelId: 'model-a',
          reasoning: {
            kind: 'levels',
            supportsOff: true,
            levels: ['high', 'max'],
            defaultSelection: 'high',
            wireProfile: {
              kind: 'anthropic',
              on: 'high',
              levels: { high: 'high', max: 'max' },
              onMode: 'enabled',
              offMode: 'disabled',
            },
          },
          fast: {
            kind: 'request-param',
            entitlement: 'granted',
            patch: { service_tier: 'priority' },
          },
          contextTiers: [{
            id: 'default',
            activation: { kind: 'header', headers: { 'x-context': 'large' } },
          }],
        }],
      },
    }));

    expect(model.reasoning).toEqual(expect.objectContaining({
      kind: 'levels',
      levels: ['high', 'max'],
      defaultSelection: 'high',
    }));
    expect(model.reasoning).not.toHaveProperty('lockedSelection');
    expect(model.reasoning.wireProfile).toEqual(expect.objectContaining({ kind: 'anthropic' }));
    expect(model.fast).toEqual({
      kind: 'request-param',
      entitlement: 'granted',
      patch: { service_tier: 'priority' },
    });
    expect(model.contextTiers[0].activation).toEqual({
      kind: 'header',
      headers: { 'x-context': 'large' },
    });
  });

  it('applies official overlays only to exact live-discovered model ids', async () => {
    const { mergeEffectiveCatalog } = await import('./EffectiveCatalogService');
    const [model] = mergeEffectiveCatalog(request({
      discovery: {
        source: 'discovery',
        observedAt: '2026-01-02T00:00:00.000Z',
        models: [{ modelId: 'model-a', label: 'Live model' }],
      },
      overlay: {
        source: 'overlay',
        observedAt: '2026-01-03T00:00:00.000Z',
        models: [
          { modelId: 'model-a', fixedTemperature: 0.25 },
          { modelId: 'model-not-live', label: 'Must not be created', fixedTemperature: 1 },
        ],
      },
    }));
    expect(model.fixedTemperature).toBe(0.25);
    expect(mergeEffectiveCatalog(request({
      overlay: {
        source: 'overlay',
        observedAt: '2026-01-03T00:00:00.000Z',
        models: [{ modelId: 'model-not-live', fixedTemperature: 1 }],
      },
    })).map((entry) => entry.modelId)).toEqual(['model-a']);
  });

  it('does not let persisted app-managed preferences create models absent from the live catalog', async () => {
    const { mergeEffectiveCatalog } = await import('./EffectiveCatalogService');
    const models = mergeEffectiveCatalog(request({
      seed: {
        source: 'seed',
        observedAt: '2026-01-01T00:00:00.000Z',
        models: [],
      },
      discovery: {
        source: 'discovery',
        observedAt: '2026-01-02T00:00:00.000Z',
        models: [{ modelId: 'live-model', label: 'Live model', availability: 'available' }],
      },
      user: {
        source: 'user',
        observedAt: '2026-01-03T00:00:00.000Z',
        models: [
          { modelId: 'live-model', defaultBudgetTokens: 128_000 },
          { modelId: 'claude-not-returned', defaultBudgetTokens: 256_000 },
        ],
      },
    }));

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ modelId: 'live-model', defaultBudgetTokens: 128_000 });
  });

  it('removes historical media-output entries from discovery and persisted catalog state', async () => {
    const { EffectiveCatalogService, mergeEffectiveCatalog } = await import('./EffectiveCatalogService');
    const cleanModels = mergeEffectiveCatalog(request({
      seed: { source: 'seed', observedAt: '2026-01-01T00:00:00.000Z', models: [] },
      discovery: {
        source: 'discovery',
        observedAt: '2026-01-02T00:00:00.000Z',
        models: [
          { modelId: 'grok-4.5', availability: 'available' },
          { modelId: 'grok-imagine-video-1.5', availability: 'available' },
        ],
      },
      user: {
        source: 'user',
        observedAt: '2026-01-03T00:00:00.000Z',
        models: [{ modelId: 'grok-imagine-video-1.5', enabled: true }],
      },
    }));
    expect(cleanModels.map((model) => model.modelId)).toEqual(['grok-4.5']);

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({
      schemaVersion: 2,
      discoveries: {
        historical: {
          source: 'discovery',
          observedAt: '2026-01-02T00:00:00.000Z',
          models: [
            { modelId: 'grok-4.5' },
            { modelId: 'grok-imagine-video' },
          ],
        },
      },
      entitlements: {},
      observed: {},
    }), 'utf8');
    new EffectiveCatalogService({ statePath });
    const persisted = JSON.parse(fs.readFileSync(statePath, 'utf8')) as {
      discoveries: Record<string, { models: Array<{ modelId: string }> }>;
    };
    expect(persisted.discoveries.historical.models.map((model) => model.modelId)).toEqual(['grok-4.5']);
  });

  it('rekeys punctuation-equivalent live ids while preserving the seed id as a proven alias', async () => {
    const { mergeEffectiveCatalog } = await import('./EffectiveCatalogService');
    const [model] = mergeEffectiveCatalog(request({
      seed: {
        source: 'seed',
        observedAt: '2026-01-01T00:00:00.000Z',
        models: [{
          modelId: 'claude-opus-4-8',
          label: 'Seed Opus',
          availability: 'available',
          fast: { kind: 'unsupported' },
        }],
      },
      discovery: {
        source: 'discovery',
        observedAt: '2026-01-02T00:00:00.000Z',
        models: [
          { modelId: 'claude-opus-4.8', label: 'Live Opus', availability: 'available' },
          {
            modelId: 'claude-opus-4-8',
            availability: 'unavailable',
            unavailableReason: 'This model was not returned by the latest successful provider discovery.',
          },
        ],
      },
    }));

    expect(model).toMatchObject({
      modelId: 'claude-opus-4.8',
      label: 'Live Opus',
      aliases: ['claude-opus-4-8'],
      availability: 'available',
      fast: { kind: 'unsupported' },
    });
    expect(model.provenance).toContainEqual(expect.objectContaining({ field: 'modelId', source: 'discovery' }));
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
        if (source !== 'user' && (source !== 'overlay' || (mask & 1) !== 0)) {
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

  it('persists entitlement separately and isolates it by account and protocol', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date('2026-01-01T00:00:00.000Z') });
    await service.refreshDiscovery(request(), async () => ({
      models: [{
        modelId: 'model-a',
        contextTiers: [{ id: 'default', entitlement: 'unknown' }],
      }],
      entitlement: {
        detail: 'ClinePass model group',
        models: [{
          modelId: 'model-a',
          contextTiers: [{ id: 'default', label: 'ClinePass', entitlement: 'granted' }],
        }],
      },
    }));

    const reloaded = new EffectiveCatalogService({ statePath, now: () => new Date('2026-01-01T00:00:01.000Z') });
    const accountA = reloaded.getSnapshot(request()).models[0];
    expect(accountA.contextTiers[0]).toMatchObject({ label: 'ClinePass', entitlement: 'granted' });
    expect(accountA.provenance).toContainEqual(expect.objectContaining({
      field: 'contextTiers.default.entitlement',
      source: 'entitlement',
      detail: 'ClinePass model group',
    }));
    const accountB = reloaded.getSnapshot(request({ accountId: 'account-b' })).models[0];
    expect(accountB.contextTiers[0].label).toBe('Default');
    expect(accountB.provenance).not.toContainEqual(expect.objectContaining({ source: 'entitlement' }));
    const otherProtocol = reloaded.getSnapshot(request({ protocol: 'AnthropicMessages' })).models[0];
    expect(otherProtocol.contextTiers[0].label).toBe('Default');
    expect(otherProtocol.provenance).not.toContainEqual(expect.objectContaining({ source: 'entitlement' }));

    await reloaded.refreshDiscovery(request(), async () => ({
      models: [{ modelId: 'model-a', contextTiers: [{ id: 'default', entitlement: 'unknown' }] }],
    }));
    const replaced = reloaded.getSnapshot(request()).models[0];
    expect(replaced.contextTiers[0].label).toBe('Default');
    expect(replaced.provenance.filter((entry) => entry.field === 'contextTiers.default.entitlement').at(-1)?.source)
      .toBe('discovery');

    reloaded.invalidateDiscovery({ providerId: 'provider-a', accountId: 'account-a', protocol: route.protocol });
    expect(reloaded.getSnapshot(request()).models[0].contextTiers[0].label).toBe('Default');
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

  it('uses the latest matching observed evidence and never leaks protocol-specific evidence', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    let nowMs = Date.parse('2026-01-02T00:00:00.000Z');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date(nowMs) });
    service.recordObserved(
      { providerId: 'provider-a', accountId: 'account-a', protocol: route.protocol },
      [{ modelId: 'model-a', toolCalling: { state: 'supported' } }],
      'first result',
    );
    nowMs += 1000;
    service.recordObserved(
      { providerId: 'provider-a', accountId: 'account-a', protocol: route.protocol },
      [{ modelId: 'model-a', toolCalling: { state: 'unsupported', reason: 'latest rejection' } }],
      'latest result',
    );

    const matching = service.getSnapshot(request()).models[0];
    expect(matching.toolCalling).toEqual({ state: 'unsupported', reason: 'latest rejection' });
    expect(matching.provenance.filter((entry) => entry.field === 'toolCalling.state').at(-1))
      .toMatchObject({ source: 'observed', detail: 'latest result' });
    expect(service.getSnapshot(request({
      protocol: 'AnthropicMessages',
      fallbackRoute: {
        protocol: 'AnthropicMessages',
        baseUrl: 'https://example.test/messages',
        source: 'preset',
      },
    })).models[0].toolCalling)
      .toEqual({ state: 'supported' });
  });

  it('projects route-protocol evidence into the provider catalog snapshot and broadcasts it', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date('2026-07-13T00:00:00.000Z') });
    const catalogRequest = request({
      protocol: 'OpenAIResponses',
      seed: {
        source: 'seed',
        observedAt: '2026-01-01T00:00:00.000Z',
        models: [{
          modelId: 'model-chat',
          label: 'Chat-routed model',
          availability: 'available',
          route: {
            protocol: 'OpenAICompatibleChatCompletions',
            baseUrl: 'https://example.test/v1',
            source: 'model',
          },
          toolCalling: { state: 'unknown' },
        }, {
          modelId: 'model-responses',
          label: 'Responses-routed model',
          availability: 'available',
          route: {
            protocol: 'OpenAIResponses',
            baseUrl: 'https://example.test/v1/responses',
            source: 'model',
          },
          toolCalling: { state: 'unknown' },
        }],
      },
    });
    const snapshots: Array<ReturnType<typeof service.getSnapshot>> = [];
    service.subscribe((snapshot) => snapshots.push(snapshot));
    service.getSnapshot(catalogRequest);

    service.recordObserved(
      {
        providerId: 'provider-a',
        accountId: 'account-a',
        protocol: 'OpenAICompatibleChatCompletions',
      },
      [{ modelId: 'model-chat', toolCalling: { state: 'supported' } }],
      'structured adapter event',
    );

    const latest = snapshots.at(-1);
    expect(latest?.protocol).toBe('OpenAIResponses');
    expect(latest?.models.find((model) => model.modelId === 'model-chat')?.toolCalling)
      .toEqual({ state: 'supported' });
    expect(latest?.models.find((model) => model.modelId === 'model-responses')?.toolCalling)
      .toEqual({ state: 'unknown' });
    expect(latest?.models.find((model) => model.modelId === 'model-chat')?.provenance)
      .toContainEqual(expect.objectContaining({
        field: 'toolCalling.state',
        source: 'observed',
        protocol: 'OpenAICompatibleChatCompletions',
        detail: 'structured adapter event',
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
