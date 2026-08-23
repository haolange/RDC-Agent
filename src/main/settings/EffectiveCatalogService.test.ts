import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EffectiveCatalogRequest } from './effectiveCatalogTypes';

const electronMock = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({
  app: { getPath: () => electronMock.root },
}));

const route = {
  protocol: 'OpenAICompatibleChatCompletions' as const,
  baseUrl: 'https://example.test/v1',
  source: 'catalog' as const,
};

function request(overrides: Partial<EffectiveCatalogRequest> = {}): EffectiveCatalogRequest {
  return {
    providerId: 'provider-a',
    accountId: 'account-a',
    protocol: route.protocol,
    catalogOwnership: 'app-managed',
    discoveryAuthority: 'additive',
    fallbackRoute: route,
    catalog: {
      source: 'catalog',
      observedAt: '2026-01-01T00:00:00.000Z',
      models: [{
        modelId: 'model-a',
        label: 'Catalog label',
        availability: 'available',
        contextTiers: [{
          id: 'default',
          label: 'Default',
          maxPromptTokens: 200_000,
          activation: { kind: 'implicit' },
          entitlement: 'granted',
        }],
        controls: {
          fast: { state: 'unsupported', fixedValue: false },
          maxContext: { state: 'unsupported', fixedValue: false },
        },
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

  it('marks a discovery-only model without a positive executable context budget unavailable', async () => {
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
    const [model] = mergeEffectiveCatalog(request({
      catalog: {
        source: 'catalog',
        observedAt: '2026-01-01T00:00:00.000Z',
        models: [],
      },
      discovery: {
        source: 'discovery',
        observedAt: '2026-01-02T00:00:00.000Z',
        models: [{
          modelId: 'discovery-without-limits',
          label: 'Discovery without limits',
          availability: 'available',
          routeOptions: [{
            id: 'chat',
            route,
            availability: 'available',
          }],
        }],
      },
    }));

    expect(model).toMatchObject({
      modelId: 'discovery-without-limits',
      availability: 'unavailable',
      defaultBudgetTokens: 0,
      unavailableReason: expect.stringContaining('positive executable context budget'),
    });
  });

  it('merges every layer by field and records winning field evidence', async () => {
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
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
      expect.objectContaining({
        field: 'label',
        source: 'discovery',
        value: 'Discovered label',
        conflict: expect.stringContaining('Catalog label'),
      }),
      expect.objectContaining({ field: 'contextTiers.default.maxPromptTokens', source: 'discovery' }),
      expect.objectContaining({ field: 'contextTiers.long.entitlement', source: 'entitlement' }),
      expect.objectContaining({ field: 'structuredOutput.state', source: 'observed' }),
      expect.objectContaining({ field: 'defaultBudgetTokens', source: 'user' }),
    ]));
  });

  it('keeps a catalog-owned Max tier structural when billing reports a lower default threshold', async () => {
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
    const [model] = mergeEffectiveCatalog(request({
      catalog: {
        ...request().catalog,
        models: [{
          ...request().catalog.models[0],
          contextTiers: [{
            id: 'default',
            label: 'Max mode',
            maxTotalTokens: 1_000_000,
            activation: { kind: 'implicit' },
            entitlement: 'granted',
          }],
          controls: {
            fast: { state: 'unsupported', fixedValue: false },
            maxContext: { state: 'fixed', fixedValue: true, tierId: 'default' },
          },
        }],
      },
      entitlement: {
        source: 'entitlement',
        observedAt: '2026-07-17T00:00:00.000Z',
        models: [{
          modelId: 'model-a',
          contextTiers: [{
            id: 'default',
            maxPromptTokens: 200_000,
            maxOutputTokens: 64_000,
            maxTotalTokens: 264_000,
          }],
        }],
      },
    }));

    expect(model.availability).toBe('available');
    expect(model.contextTiers[0]).toMatchObject({
      maxTotalTokens: 1_000_000,
      entitlement: 'granted',
    });
    expect(model.resolvedControls?.maxContext).toMatchObject({
      state: 'fixed',
      value: true,
      disabled: true,
    });
  });

  it('projects field-level fact sources onto every affected leaf', async () => {
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
    const [model] = mergeEffectiveCatalog(request({
      catalog: {
        source: 'catalog',
        sourceKind: 'rdc-agent',
        observedAt: '2026-07-15',
        models: [{
          modelId: 'model-a',
          controls: {
            fast: { state: 'selectable', defaultValue: true, entitlement: 'granted' },
          },
          factSource: {
            sourceKind: 'rdc-agent',
            sourceRevision: 'user-catalog',
            observedAt: '2026-07-14',
          },
          fieldFactSources: {
            'controls.fast': {
              sourceKind: 'opencode',
              sourceRevision: '571e7b852f82415faf65466e1536357a048bdf5a',
              observedAt: '2026-07-15',
              surface: 'model-control-panel',
            },
          },
        }],
      },
    }));

    for (const field of ['controls.fast.state', 'controls.fast.defaultValue', 'controls.fast.entitlement']) {
      expect(model.provenance.filter((entry) => entry.field === field).at(-1), field).toMatchObject({
        source: 'catalog',
        sourceKind: 'opencode',
        sourceRevision: '571e7b852f82415faf65466e1536357a048bdf5a',
        surface: 'model-control-panel',
      });
    }
  });

  it('projects an exact user route option without allowing provider-wide route mutation', async () => {
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
    const [model] = mergeEffectiveCatalog(request({
      catalog: {
        ...request().catalog,
        models: [{
          ...request().catalog.models[0],
          routeOptions: [{
            id: 'openai', route, availability: 'available',
          }, {
            id: 'anthropic',
            route: { protocol: 'AnthropicMessages', baseUrl: 'https://example.test/v1', source: 'catalog' },
            availability: 'available',
          }],
        }],
      },
      user: {
        source: 'user',
        observedAt: '2026-01-06T00:00:00.000Z',
        models: [{ modelId: 'model-a', preferredRouteOptionId: 'anthropic' }],
      },
    }));

    expect(model.preferredRouteOptionId).toBe('anthropic');
    expect(model.route.protocol).toBe('AnthropicMessages');
    expect(model.routeRevision).toBe(model.routeOptions?.find((option) => option.id === 'anthropic')?.routeRevision);
  });

  it('replaces discriminated capability unions atomically across kinds', async () => {
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
    const [model] = mergeEffectiveCatalog(request({
      discovery: {
        source: 'discovery',
        observedAt: '2026-01-02T00:00:00.000Z',
        models: [{
          modelId: 'model-a',
          controls: {
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
            fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
          },
          executionBindings: [{
            id: 'fast:priority', when: { fast: true },
            actions: [{ kind: 'request-patch', patch: { service_tier: 'priority' } }], entitlement: 'granted',
          }],
          contextTiers: [{
            id: 'default',
            activation: { kind: 'header', headers: { 'x-context': 'large' } },
          }],
        }],
      },
    }));

    expect(model.controls.reasoning).toEqual(expect.objectContaining({
      kind: 'levels',
      levels: ['high', 'max'],
      defaultSelection: 'high',
    }));
    expect(model.controls.reasoning).not.toHaveProperty('lockedSelection');
    expect(model.controls.reasoning.wireProfile).toEqual(expect.objectContaining({ kind: 'anthropic' }));
    expect(model.controls.fast).toEqual({ state: 'selectable', defaultValue: false, entitlement: 'granted' });
    expect(model.executionBindings?.[0]).toMatchObject({ id: 'fast:priority' });
    expect(model.contextTiers[0].activation).toEqual({
      kind: 'header',
      headers: { 'x-context': 'large' },
    });
  });

  it('applies exact overlays only to admitted Catalog or live-discovered model ids', async () => {
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
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
        models: [{ modelId: 'model-a', fixedTemperature: 0.5 }],
      },
    }))[0]?.fixedTemperature).toBe(0.5);
    expect(mergeEffectiveCatalog(request({
      overlay: {
        source: 'overlay',
        observedAt: '2026-01-03T00:00:00.000Z',
        models: [{ modelId: 'model-not-live', fixedTemperature: 1 }],
      },
    })).map((entry) => entry.modelId)).toEqual(['model-a']);
  });

  it('does not let persisted app-managed preferences create models absent from the live catalog', async () => {
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
    const models = mergeEffectiveCatalog(request({
      catalog: {
        source: 'catalog',
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
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    const cleanModels = mergeEffectiveCatalog(request({
      catalog: { source: 'catalog', observedAt: '2026-01-01T00:00:00.000Z', models: [] },
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
      schemaVersion: 4,
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
      schemaVersion: number;
      discoveries: Record<string, { models: Array<{ modelId: string }> }>;
    };
    expect(persisted.schemaVersion).toBe(8);
    expect(persisted.discoveries).toEqual({});
  });

  it('keeps compiled positive budgets when a context-less discovery row reports zero', async () => {
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
    const [model] = mergeEffectiveCatalog(request({
      catalog: {
        source: 'catalog',
        observedAt: '2026-01-01T00:00:00.000Z',
        models: [{
          modelId: 'minimax-m3',
          label: 'MiniMax M3',
          availability: 'unknown',
          defaultBudgetTokens: 256_000,
        }],
      },
      discovery: {
        source: 'discovery',
        observedAt: '2026-01-02T00:00:00.000Z',
        models: [{
          modelId: 'minimax-m3',
          label: 'MiniMax M3',
          availability: 'available',
          defaultBudgetTokens: 0,
        }],
      },
    }));
    expect(model).toMatchObject({
      modelId: 'minimax-m3',
      availability: 'available',
      defaultBudgetTokens: 256_000,
    });
  });

  it('rekeys punctuation-equivalent live ids while preserving the Catalog id as a proven alias', async () => {
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
    const [model] = mergeEffectiveCatalog(request({
      catalog: {
        source: 'catalog',
        observedAt: '2026-01-01T00:00:00.000Z',
        models: [{
          modelId: 'claude-opus-4-8',
          label: 'Seed Opus',
          availability: 'available',
          defaultBudgetTokens: 200_000,
          controls: { fast: { state: 'unsupported', fixedValue: false } },
        }],
      },
      discovery: {
        source: 'discovery',
        observedAt: '2026-01-02T00:00:00.000Z',
        models: [{ modelId: 'claude-opus-4.8', label: 'Live Opus', availability: 'available' }],
      },
    }));

    expect(model).toMatchObject({
      modelId: 'claude-opus-4.8',
      label: 'Live Opus',
      aliases: ['claude-opus-4-8'],
      availability: 'available',
      controls: { fast: { state: 'unsupported', fixedValue: false } },
    });
    expect(model.provenance).toContainEqual(expect.objectContaining({ field: 'modelId', source: 'discovery' }));
  });

  it('lets live evidence narrow but never promote a manifest-level explicit denial', async () => {
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
    const [model] = mergeEffectiveCatalog(request({
      catalog: {
        source: 'catalog',
        observedAt: '2026-07-14',
        models: [{
          modelId: 'kimi-k2.7-code',
          availability: 'unavailable',
          unavailableReason: 'Unavailable in the user-observed control panel.',
          factSource: {
            sourceKind: 'rdc-agent',
            sourceRevision: 'user-catalog-2026-07-14',
            observedAt: '2026-07-14',
            refreshedAt: '2026-07-15T13:04:00+08:00',
            surface: 'volcengine-coding-plan',
            accountScope: 'observed-account',
          },
        }],
      },
      discovery: {
        source: 'discovery',
        sourceKind: 'live-catalog',
        observedAt: '2026-07-15T00:00:00.000Z',
        models: [{ modelId: 'kimi-k2.7-code', availability: 'available', label: 'Live Kimi' }],
      },
    }));

    expect(model).toMatchObject({
      label: 'Live Kimi',
      availability: 'unavailable',
      unavailableReason: 'Unavailable in the user-observed control panel.',
    });
    expect(model.provenance.filter((entry) => entry.field === 'availability').at(-1)).toMatchObject({
      source: 'catalog',
      sourceKind: 'rdc-agent',
      sourceRevision: 'user-catalog-2026-07-14',
      surface: 'volcengine-coding-plan',
      accountScope: 'observed-account',
    });
  });

  it('merges every deterministic optional-layer combination with last present leaf provenance', async () => {
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
    const layers = [
      ['discovery', 'discovery'],
      ['overlay', 'overlay'],
      ['entitlement', 'entitlement'],
      ['observed', 'observed'],
      ['user', 'user'],
    ] as const;
    for (let mask = 0; mask < 2 ** layers.length; mask += 1) {
      const overrides: Partial<EffectiveCatalogRequest> = {};
      let expectedLabel = 'Catalog label';
      let expectedSource = 'catalog';
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

  it('does not let app-managed user overlays grant toolCalling support', async () => {
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
    const catalog = request().catalog!;
    const [model] = mergeEffectiveCatalog(request({
      catalog: {
        ...catalog,
        models: [{
          ...catalog.models[0],
          toolCalling: { state: 'unknown' },
        }],
      },
      user: {
        source: 'user',
        observedAt: '2026-01-06T00:00:00.000Z',
        models: [{ modelId: 'model-a', toolCalling: { state: 'supported' } }],
      },
    }));
    expect(model.toolCalling).toEqual({ state: 'unknown' });
  });

  it('keeps discovery candidates without a tool-calling conclusion unknown', async () => {
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
    const [model] = mergeEffectiveCatalog(request({
      catalog: {
        source: 'catalog',
        observedAt: '2026-01-01T00:00:00.000Z',
        models: [],
      },
      discovery: {
        source: 'discovery',
        observedAt: '2026-01-02T00:00:00.000Z',
        models: [{
          modelId: 'discovery-candidate',
          label: 'Discovery candidate',
          availability: 'available',
          defaultBudgetTokens: 128_000,
          contextTiers: [{
            id: 'default',
            label: 'Default',
            maxPromptTokens: 128_000,
            activation: { kind: 'implicit' },
            entitlement: 'granted',
          }],
        }],
      },
    }));
    expect(model.toolCalling).toEqual({ state: 'unknown' });
    expect(model.availability).toBe('available');
  });

  it('allows full user-managed overrides', async () => {
    const { mergeEffectiveCatalog } = await import('./effectiveCatalogMerge');
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

    expect(service.getSnapshot(request()).models[0].label).toBe('Catalog label');
    await vi.waitFor(() => expect(service.getSnapshot(request()).models[0].label).toBe('Cold discovery'));
    expect(loader).toHaveBeenCalledTimes(1);

    nowMs += 2000;
    expect(service.getSnapshot(request()).models[0].label).toBe('Cold discovery');
    await vi.waitFor(() => expect(service.getSnapshot(request()).models[0].label).toBe('SWR discovery'));
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('keeps the catalog revision stable when refresh only renews evidence timestamps', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date(nowMs) });

    await service.refreshDiscovery(request(), async () => ({
      models: [{ modelId: 'model-a', label: 'Stable discovery' }],
    }));
    const first = service.getSnapshot(request());

    nowMs += 60_000;
    await service.refreshDiscovery(request(), async () => ({
      models: [{ modelId: 'model-a', label: 'Stable discovery' }],
    }));
    const timestampOnlyRefresh = service.getSnapshot(request());

    expect(timestampOnlyRefresh.models[0].provenance).not.toEqual(first.models[0].provenance);
    expect(timestampOnlyRefresh.catalogRevision).toBe(first.catalogRevision);

    await service.refreshDiscovery(request(), async () => ({
      models: [{ modelId: 'model-a', label: 'Changed discovery' }],
    }));
    expect(service.getSnapshot(request()).catalogRevision).not.toBe(first.catalogRevision);
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
        detail: 'Account plan entitlement',
        models: [{
          modelId: 'model-a',
          contextTiers: [{ id: 'default', label: 'Plan', entitlement: 'granted' }],
        }],
      },
    }));

    const reloaded = new EffectiveCatalogService({ statePath, now: () => new Date('2026-01-01T00:00:01.000Z') });
    const accountA = reloaded.getSnapshot(request()).models[0];
    expect(accountA.contextTiers[0]).toMatchObject({ label: 'Plan', entitlement: 'granted' });
    expect(accountA.provenance).toContainEqual(expect.objectContaining({
      field: 'contextTiers.default.entitlement',
      source: 'entitlement',
      detail: 'Account plan entitlement',
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
      'tool:model-a',
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

  it('writes observed provenance even when catalog already marks toolCalling supported', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date('2026-08-23T00:00:00.000Z') });
    service.getSnapshot(request());
    service.recordObserved(
      { providerId: 'provider-a', accountId: 'account-a', protocol: route.protocol },
      'tool-calling:model-a:OpenAICompatibleChatCompletions',
      [{ modelId: 'model-a', toolCalling: { state: 'supported' } }],
      'Structured tool call completed through the active provider adapter.',
    );
    const [model] = service.getSnapshot(request()).models;
    expect(model.toolCalling).toEqual({ state: 'supported' });
    expect(model.provenance).toContainEqual(expect.objectContaining({
      field: 'toolCalling.state',
      source: 'observed',
      detail: 'Structured tool call completed through the active provider adapter.',
    }));
  });

  it('uses the latest matching observed evidence and never leaks protocol-specific evidence', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    let nowMs = Date.parse('2026-01-02T00:00:00.000Z');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date(nowMs) });
    service.recordObserved(
      { providerId: 'provider-a', accountId: 'account-a', protocol: route.protocol },
      'tool:model-a',
      [{ modelId: 'model-a', toolCalling: { state: 'supported' } }],
      'first result',
    );
    nowMs += 1000;
    service.recordObserved(
      { providerId: 'provider-a', accountId: 'account-a', protocol: route.protocol },
      'tool:model-a',
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
        source: 'catalog',
      },
    })).models[0].toolCalling)
      .toEqual({ state: 'supported' });
  });

  it('projects route-protocol evidence into the provider catalog snapshot and broadcasts it', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date('2026-07-13T00:00:00.000Z') });
    const catalogRequest = request({
      protocol: 'OpenAIResponses',
      catalog: {
        source: 'catalog',
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
      'tool:model-chat',
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
      'vision:model-a',
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

    expect(service.getSnapshot(request()).models[0].label).toBe('Catalog label');
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

  it('replaces scoped observed evidence and expires entitlement denials', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    let nowMs = Date.parse('2026-07-13T00:00:00.000Z');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date(nowMs) });
    const scope = { providerId: 'provider-a', accountId: 'account-a', protocol: route.protocol };
    service.recordObserved(
      scope,
      'capability-probe:model-a:fast',
      [{ modelId: 'model-a', controls: { fast: { state: 'selectable', defaultValue: false, entitlement: 'denied' } } }],
      'denied',
      60_000,
    );
    expect(service.getSnapshot(request()).models[0].controls.fast).toMatchObject({ entitlement: 'denied' });

    nowMs += 1_000;
    service.recordObserved(
      scope,
      'capability-probe:model-a:fast',
      [{ modelId: 'model-a', controls: { fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' } } }],
      'granted',
      60_000,
    );
    const replaced = service.getSnapshot(request()).models[0];
    expect(replaced.controls.fast).toMatchObject({ entitlement: 'granted' });
    expect(replaced.provenance.filter((entry) => entry.field === 'controls.fast.entitlement' && entry.source === 'observed'))
      .toHaveLength(1);

    nowMs += 61_000;
    const expired = service.getSnapshot(request()).models[0];
    expect(expired.controls.fast).toEqual({ state: 'unsupported', fixedValue: false });
    expect(
      expired.provenance.some(
        (entry) => entry.field === 'controls.fast.entitlement' && entry.source === 'observed',
      ),
    ).toBe(false);
  });

  it('backs off automatic refresh after failure and clears backoff on success', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date(nowMs), discoveryTtlMs: 1000 });
    const failingLoader = vi.fn(async () => { throw new Error('offline'); });
    service.setDiscoveryLoaderResolver(() => failingLoader);

    await service.refreshDiscovery(request(), failingLoader);
    expect(failingLoader).toHaveBeenCalledTimes(1);

    nowMs += 2000;
    service.getSnapshot(request());
    expect(failingLoader).toHaveBeenCalledTimes(1);

    nowMs += 30_000;
    service.getSnapshot(request());
    await vi.waitFor(() => expect(failingLoader).toHaveBeenCalledTimes(2));

    const successLoader = vi.fn(async () => ({ models: [{ modelId: 'model-a', label: 'Recovered' }] }));
    await service.refreshDiscovery(request(), successLoader);
    expect(successLoader).toHaveBeenCalledTimes(1);

    nowMs += 2000;
    failingLoader.mockClear();
    service.setDiscoveryLoaderResolver(() => failingLoader);
    service.getSnapshot(request());
    await vi.waitFor(() => expect(failingLoader).toHaveBeenCalledTimes(1));
  });

  it('explicit refreshDiscovery bypasses failure backoff', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    let nowMs = Date.parse('2026-01-01T00:00:00.000Z');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date(nowMs), discoveryTtlMs: 1000 });
    const failingLoader = vi.fn(async () => { throw new Error('offline'); });

    await service.refreshDiscovery(request(), failingLoader);
    expect(failingLoader).toHaveBeenCalledTimes(1);

    nowMs += 1000;
    await service.refreshDiscovery(request(), failingLoader);
    expect(failingLoader).toHaveBeenCalledTimes(2);
  });

  it('deduplicates emit when snapshot fingerprint is unchanged', async () => {
    const { EffectiveCatalogService } = await import('./EffectiveCatalogService');
    const service = new EffectiveCatalogService({ statePath, now: () => new Date('2026-01-01T00:00:00.000Z') });
    const listener = vi.fn();
    service.subscribe(listener);
    const loader = vi.fn(async () => ({ models: [{ modelId: 'model-a', label: 'Stable' }] }));

    await service.refreshDiscovery(request(), loader);
    expect(listener).toHaveBeenCalledTimes(1);

    await service.refreshDiscovery(request(), loader);
    expect(listener).toHaveBeenCalledTimes(1);

    await service.refreshDiscovery(request(), async () => ({ models: [{ modelId: 'model-a', label: 'Changed' }] }));
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
