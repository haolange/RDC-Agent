import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  compileProviderCatalog,
  MODELS_DEV_IDENTITY_COUNT,
  MODELS_DEV_SNAPSHOT_SHA256,
  type ProviderCatalogCompileInput,
} from './compiler';
import { loadProviderCatalogManifestInput } from './nodeManifestLoader';

const manifestRoot = path.resolve(process.cwd(), 'src/shared/provider-catalog/manifests');

function input(): ProviderCatalogCompileInput {
  return loadProviderCatalogManifestInput(manifestRoot);
}

function clone(value: ProviderCatalogCompileInput): ProviderCatalogCompileInput {
  return JSON.parse(JSON.stringify(value)) as ProviderCatalogCompileInput;
}

function mutableSurface(value: ProviderCatalogCompileInput, id: string): Record<string, any> {
  const surface = value.surfaces.find((entry) => (entry as { id?: unknown }).id === id);
  if (!surface || typeof surface !== 'object') throw new Error(`Missing fixture surface ${id}`);
  return surface as Record<string, any>;
}

describe('Provider Catalog compiler', () => {
  it('keeps every user-facing one-million control named Max mode', () => {
    const translations = fs.readFileSync(
      path.resolve(process.cwd(), 'src/renderer/i18n.ts'),
      'utf8',
    );
    for (const banned of [
      "'1M context'",
      "'1M 上下文'",
      "'Verify 1M'",
      "'验证 1M'",
      "'1M mode'",
      "'1M 模式'",
    ]) {
      expect(translations, banned).not.toContain(banned);
    }

    for (const surface of input().surfaces as Array<{ models?: Array<{ contextTiers?: Array<{ label?: string }> }> }>) {
      for (const model of surface.models ?? []) {
        for (const tier of model.contextTiers ?? []) {
          expect(['1M context', 'Fixed 1M context']).not.toContain(tier.label);
        }
      }
    }
  });

  it('compiles the pinned 166 identities and every explicit RDC surface deterministically', () => {
    const source = input();
    const first = compileProviderCatalog(source);
    const reversed = compileProviderCatalog({
      identities: [...source.identities].reverse(),
      profiles: [...source.profiles].reverse(),
      surfaces: [...source.surfaces].reverse(),
    });

    expect(first.index.identityCount).toBe(MODELS_DEV_IDENTITY_COUNT);
    expect(first.identities).toHaveLength(166);
    expect(first.identities.every((identity) => (
      identity.provenance.sourceRevision === MODELS_DEV_SNAPSHOT_SHA256
    ))).toBe(true);
    expect(first.index.catalogRevision).toBe(reversed.index.catalogRevision);
    expect(first.index.surfaceCount).toBe(first.surfaces.size);
    expect(first.index.modelCount).toBeGreaterThanOrEqual(200);
  });

  it('keeps provider reasoning semantics route-scoped and manifest-driven', () => {
    const catalog = compileProviderCatalog(input());
    const kimi = catalog.surfaces.get('kimi-coding-plan')?.surface;
    expect(kimi?.routes.map((route) => ({
      protocol: route.protocol,
      semantic: route.contracts.reasoning.semantic,
      label: route.contracts.reasoning.displayLabel,
    }))).toEqual([
      { protocol: 'AnthropicMessages', semantic: 'raw', label: 'Raw reasoning' },
      { protocol: 'OpenAICompatibleChatCompletions', semantic: 'raw', label: 'Raw reasoning' },
    ]);

    const custom = catalog.surfaces.get('custom-endpoint')?.surface;
    expect(custom?.routes.every((route) => route.contracts.reasoning.semantic === 'unknown')).toBe(true);
  });

  it('exposes protocols only through precise model route matrices', () => {
    const catalog = compileProviderCatalog(input());
    expect(catalog.index.surfaces.every((surface) => !('userSelectableRoute' in surface))).toBe(true);

    const longcat = catalog.surfaces.get('longcat')?.surface;
    expect(longcat).toMatchObject({ category: 'compatible-access', surfaceKind: 'compatible-api' });
    expect(longcat?.models[0]?.routeOptions?.map((option) => option.id)).toEqual([
      'OpenAICompatibleChatCompletions',
      'AnthropicMessages',
    ]);
    expect(longcat?.routes.map((route) => route.protocolOwner)).toEqual(['openai', 'anthropic']);

    const vertex = catalog.surfaces.get('google-vertex')?.surface;
    const vertexAnthropic = catalog.surfaces.get('google-vertex-anthropic')?.surface;
    expect(vertex).toMatchObject({ category: 'cloud-platform', surfaceKind: 'cloud' });
    expect(vertex?.routes.map((route) => route.protocol)).toEqual([
      'GoogleVertexGemini',
      'OpenAICompatibleChatCompletions',
    ]);
    expect(vertex?.routes.map((route) => route.protocolOwner)).toEqual(['google', 'openai']);
    expect(vertexAnthropic?.routes.map((route) => route.protocol)).toEqual(['GoogleVertexAnthropic']);

    for (const surfaceId of ['xiaomi-mimo', 'xiaomi-mimo-token-plan']) {
      const xiaomi = catalog.surfaces.get(surfaceId)?.surface;
      expect(xiaomi?.routes.map((route) => route.protocol), surfaceId).toEqual([
        'OpenAICompatibleChatCompletions',
        'OpenAIResponses',
      ]);
      expect(xiaomi?.models[0]?.routeOptions?.map((option) => option.id), surfaceId).toEqual([
        'OpenAICompatibleChatCompletions',
        'OpenAIResponses',
      ]);
    }
  });

  it('keeps the synchronous summary index free of raw discovery and execution internals', () => {
    const catalog = compileProviderCatalog(input());
    const summary = catalog.index.surfaces.find((surface) => surface.id === 'cortecs') as Record<string, unknown>;
    expect(summary).not.toHaveProperty('discovery');
    expect(summary).not.toHaveProperty('discoveredModelProjection');
    expect(summary).not.toHaveProperty('discoveryPolicyId');
    expect(summary.models).not.toEqual(expect.arrayContaining([expect.objectContaining({ liveProjection: expect.anything() })]));
    expect(summary).not.toHaveProperty('profileId');
  });

  it('fails closed when category, surface kind, endpoint class, or ownership conflict', () => {
    const longcat = clone(input());
    mutableSurface(longcat, 'longcat').category = 'official-direct';
    expect(() => compileProviderCatalog(longcat)).toThrow(/invalid explicit shape/u);

    const vertex = clone(input());
    mutableSurface(vertex, 'google-vertex').endpointOwnership = 'service-operator';
    expect(() => compileProviderCatalog(vertex)).toThrow(/invalid explicit shape/u);

    const openai = clone(input());
    mutableSurface(openai, 'openai').surfaceKind = 'compatible-api';
    expect(() => compileProviderCatalog(openai)).toThrow(/invalid explicit shape/u);

    const foreignWire = clone(input());
    mutableSurface(foreignWire, 'openai').routes[0].protocolOwner = 'foreign-wire';
    expect(() => compileProviderCatalog(foreignWire)).toThrow(/first-party direct.*protocol owner/u);
  });

  it('keeps all four official Kimi model ids behind credential-scoped discovery', () => {
    const catalog = compileProviderCatalog(input());
    const surface = catalog.surfaces.get('kimi-coding-plan')?.surface;
    expect(catalog.index.surfaces.find((entry) => entry.id === 'kimi-coding-plan')).toMatchObject({
      discoveryAuthority: 'authoritative-list',
      modelCount: 3,
    });
    expect(surface?.discovery).toMatchObject({
      authority: 'authoritative-list',
      strategy: { kind: 'custom-parser', parserId: 'kimi-code-catalog' },
    });
    expect(surface?.models.map((model) => model.modelId)).toEqual([
      'kimi-for-coding',
      'k3',
      'k3-256k',
      'kimi-for-coding-highspeed',
    ]);
    expect(surface?.models.filter((model) => model.selection.pickerVisibility === 'primary')
      .every((model) => model.presencePolicy === 'account-entitled')).toBe(true);
    expect(surface?.models.find((model) => model.modelId === 'kimi-for-coding')).toMatchObject({
      label: 'Kimi for Coding',
      controls: {
        fast: { state: 'selectable' },
        reasoning: { kind: 'always-on', supportsOff: false, lockedSelection: 'on' },
      },
      executionBindings: expect.arrayContaining([
        expect.objectContaining({
          when: { fast: true },
          actions: [{ kind: 'model-switch', targetModelId: 'kimi-for-coding-highspeed' }],
        }),
      ]),
      liveProjection: {
        entitlementDenialMatchers: [{
          mode: 'fast',
          statuses: [401],
          messageIncludes: 'does not have access to kimi-for-coding-highspeed',
        }],
      },
    });
    expect(surface?.models.find((model) => model.modelId === 'k3')).toMatchObject({
      label: 'Kimi K3',
      controls: {
        fast: { state: 'unsupported' },
        maxContext: { state: 'selectable' },
        reasoning: {
          kind: 'levels', supportsOff: false, levels: ['low', 'high', 'max'], defaultSelection: 'high',
        },
      },
      executionBindings: [{
        id: 'context:max', when: { maxContext: true },
        actions: [{ kind: 'client-tier', tierId: 'max' }],
      }],
      liveProjection: {
        entitlementDenialMatchers: [{ mode: 'max-context', statuses: [403] }],
      },
    });
    expect(surface?.models.find((model) => model.modelId === 'k3-256k')).toMatchObject({
      controls: {
        fast: { state: 'unsupported', fixedValue: false },
        maxContext: { state: 'unsupported', fixedValue: false },
        reasoning: {
          kind: 'levels', supportsOff: false, levels: ['low', 'high', 'max'], defaultSelection: 'high',
        },
      },
      visionInput: { state: 'supported' },
    });
    expect(surface?.models.find((model) => model.modelId === 'kimi-for-coding-highspeed')).toMatchObject({
      selection: { pickerVisibility: 'internal', relatedPrimaryModelIds: ['kimi-for-coding'] },
      controls: { fast: { state: 'unsupported', fixedValue: false } },
    });
    expect(surface?.models.some((model) => model.modelId === 'kimi-k2.7-code')).toBe(false);
  });
  it('keeps direct and subscription K3 identities isolated by Provider surface', () => {
    const catalog = compileProviderCatalog(input());
    const moonshot = catalog.surfaces.get('moonshot')?.surface;
    expect(moonshot?.models.find((model) => model.modelId === 'kimi-k3')).toMatchObject({
      label: 'Kimi K3',
      route: {
        protocol: 'OpenAICompatibleChatCompletions',
        baseUrl: 'https://api.moonshot.cn/v1',
      },
      controls: {
        fast: { state: 'unsupported', fixedValue: false },
        maxContext: { state: 'selectable', tierId: 'max' },
        reasoning: {
          kind: 'always-on', supportsOff: false, defaultSelection: 'max', lockedSelection: 'max',
        },
      },
    });
    const openCodeGo = catalog.surfaces.get('opencode-go')?.surface;
    expect(openCodeGo).toMatchObject({
      catalogOwnership: 'provider-managed',
      discovery: {
        authority: 'authoritative-list',
        admission: { denyPatterns: expect.arrayContaining(['deepseek-v4-flash', 'deepseek-v4-pro']) },
      },
    });
    expect(openCodeGo?.routes.every((route) => route.headers?.['x-opencode-session'] === 'rdc-agent')).toBe(true);
    expect(openCodeGo?.models.map((model) => model.modelId)).toEqual(expect.arrayContaining([
      'kimi-k3',
      'deepseek-v4.1-flash',
      'glm-5.2',
      'minimax-m3',
      'qwen3.7-max',
      'grok-4.5',
    ]));
    expect(openCodeGo?.models.length).toBeGreaterThanOrEqual(20);
    expect(openCodeGo?.models.find((model) => model.modelId === 'hy3-preview')).toMatchObject({
      availability: 'unavailable',
      unavailableReason: expect.stringContaining('model_not_supported'),
    });
    expect(openCodeGo?.models.find((model) => model.modelId === 'kimi-k3')).toMatchObject({
      presencePolicy: 'account-entitled',
      availability: 'unknown',
      controls: {
        fast: { state: 'unsupported', fixedValue: false },
        maxContext: { state: 'selectable' },
        reasoning: { kind: 'always-on', supportsOff: false, lockedSelection: 'max' },
      },
    });
    expect(openCodeGo?.models.find((model) => model.modelId === 'deepseek-v4.1-flash')).toMatchObject({
      controls: {
        fast: { state: 'unsupported' },
        maxContext: { state: 'unsupported' },
        reasoning: { kind: 'unknown', supportsOff: false },
      },
    });
    expect(catalog.surfaces.get('openrouter')?.surface.discovery.strategy)
      .toEqual({ kind: 'custom-parser', parserId: 'openrouter-catalog' });

    for (const surfaceId of ['github-copilot', 'bailian', 'bailian-coding-plan', 'volcengine-coding-plan']) {
      expect(catalog.surfaces.get(surfaceId)?.surface.models.some((model) => (
        model.modelId === 'kimi-k3' || model.modelId === 'k3'
      )), surfaceId).toBe(false);
    }
    expect(moonshot?.models.some((model) => model.modelId === 'k3')).toBe(false);
    expect(catalog.surfaces.get('kimi-coding-plan')?.surface.models.some((model) => (
      model.modelId === 'kimi-k3' || model.modelId === 'kimi-k2.7-code'
    ))).toBe(false);
  });
  it('keeps every MiniMax highspeed relation as one hidden execution target', () => {
    const catalog = compileProviderCatalog(input());
    for (const surfaceId of [
      'minimax-cn',
      'minimax-global',
      'minimax-cn-coding-plan',
      'minimax-global-coding-plan',
    ]) {
      const surface = catalog.surfaces.get(surfaceId)?.surface;
      const base = surface?.models.find((model) => model.modelId === 'MiniMax-M2.7');
      const target = surface?.models.find((model) => model.modelId === 'MiniMax-M2.7-highspeed');
      expect(base, surfaceId).toMatchObject({
        controls: { fast: { state: 'selectable' } },
        executionBindings: [{
          when: { fast: true },
          actions: [{ kind: 'model-switch', targetModelId: 'MiniMax-M2.7-highspeed' }],
        }],
      });
      expect(target, surfaceId).toMatchObject({
        selection: { pickerVisibility: 'internal', relatedPrimaryModelIds: ['MiniMax-M2.7'] },
        controls: { fast: { state: 'unsupported' } },
      });
      expect(target?.routeOptions?.map((option) => option.route.protocol))
        .toEqual(base?.routeOptions?.map((option) => option.route.protocol));
    }
  });

  it('compiles dynamic surface controls as an explicit discovery projection', () => {
    const cortecs = compileProviderCatalog(input()).surfaces.get('cortecs')?.surface;
    expect(cortecs).toMatchObject({
      catalogOwnership: 'provider-managed',
      discovery: { authority: 'authoritative-list' },
      discoveredModelProjection: {
        fast: { state: 'selectable', defaultValue: false },
        executionBindings: [{
          id: 'fast:cortecs-speed',
          actions: [{ kind: 'request-patch', patch: { preference: 'speed' } }],
        }],
      },
    });
  });

  it('matches every control-panel row recorded in the user Catalog', () => {
    const catalog = compileProviderCatalog(input());
    type ExpectedRow = readonly [
      modelId: string,
      contextTokens: number,
      maxContext: 'unknown' | 'unsupported' | 'selectable' | 'fixed',
      fast: 'unknown' | 'unsupported' | 'selectable',
      reasoningKind: 'unknown' | 'toggle' | 'always-on' | 'levels',
      supportsOff: boolean,
      levels: readonly string[],
      defaultSelection: string,
      picker?: 'primary' | 'internal',
    ];
    const verify = (surfaceId: string, rows: readonly ExpectedRow[]) => {
      const surface = catalog.surfaces.get(surfaceId)?.surface;
      expect(surface, surfaceId).toBeDefined();
      for (const [modelId, contextTokens, maxContext, fast, reasoningKind, supportsOff, levels, defaultSelection, picker = 'primary'] of rows) {
        const model = surface?.models.find((entry) => entry.modelId === modelId);
        expect(model, `${surfaceId}/${modelId}`).toBeDefined();
        const defaultTier = model?.contextTiers.find((tier) => tier.id === 'default');
        expect(defaultTier?.maxPromptTokens ?? defaultTier?.maxTotalTokens, `${surfaceId}/${modelId} context`)
          .toBe(contextTokens);
        expect(model?.controls.maxContext.state, `${surfaceId}/${modelId} 1M`).toBe(maxContext);
        expect(model?.controls.fast.state, `${surfaceId}/${modelId} Fast`).toBe(fast);
        expect(model?.controls.reasoning, `${surfaceId}/${modelId} reasoning`).toMatchObject({
          kind: reasoningKind,
          supportsOff,
          levels: [...levels],
          defaultSelection,
        });
        expect(model?.selection.pickerVisibility, `${surfaceId}/${modelId} picker`).toBe(picker);
      }
    };

    verify('chatgpt-account', [
      ['gpt-6-astra', 272_000, 'selectable', 'selectable', 'levels', false, ['low', 'medium', 'high', 'xhigh', 'max'], 'low'],
      ['gpt-5.6-sol', 272_000, 'selectable', 'selectable', 'levels', false, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['gpt-5.6-terra', 272_000, 'selectable', 'selectable', 'levels', false, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['gpt-5.6-luna', 272_000, 'selectable', 'selectable', 'levels', false, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['gpt-5.5', 272_000, 'unsupported', 'selectable', 'levels', false, ['low', 'medium', 'high', 'xhigh'], 'medium'],
      ['gpt-5.4-mini', 272_000, 'unsupported', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'xhigh'], 'medium'],
      ['gpt-5.4', 272_000, 'selectable', 'selectable', 'levels', false, ['low', 'medium', 'high', 'xhigh'], 'medium'],
      ['gpt-5.3-codex-spark', 256_000, 'unsupported', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'xhigh'], 'medium'],
    ]);
    const chatGptAccount = catalog.surfaces.get('chatgpt-account')?.surface;
    for (const model of chatGptAccount?.models ?? []) {
      expect(
        model.executionBindings?.find((binding) => binding.id === 'route:chatgpt-codex-parameter-policy'),
        `chatgpt-account/${model.modelId} Codex request policy`,
      ).toMatchObject({
        when: {},
        actions: [{
          kind: 'request-patch',
          patch: { temperature: null, top_p: null, max_output_tokens: null },
        }],
      });
      const fastBinding = model.executionBindings?.find((binding) => binding.when.fast === true);
      if (fastBinding) {
        expect(fastBinding, `chatgpt-account/${model.modelId} Fast request policy`).toMatchObject({
          actions: [{
            kind: 'request-patch',
            patch: {
              temperature: null,
              top_p: null,
              max_output_tokens: null,
              service_tier: 'priority',
            },
          }],
        });
      }
    }

    verify('github-copilot', [
      ['claude-sonnet-4.6', 1_000_000, 'fixed', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'max'], 'medium'],
      ['claude-opus-4.6', 1_000_000, 'fixed', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'max'], 'medium'],
      ['claude-opus-4.8', 1_000_000, 'fixed', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['claude-opus-4.8-fast', 1_000_000, 'fixed', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['claude-opus-5', 1_000_000, 'unknown', 'unsupported', 'unknown', false, [], 'off'],
      ['claude-sonnet-5', 1_000_000, 'fixed', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['claude-fable-5', 1_000_000, 'fixed', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['gpt-5.4-mini', 128_000, 'unsupported', 'unsupported', 'levels', true, ['low', 'medium', 'high', 'xhigh'], 'medium'],
      ['gpt-5.4', 256_000, 'selectable', 'unsupported', 'levels', true, ['low', 'medium', 'high', 'xhigh'], 'medium'],
      ['gpt-5.5', 256_000, 'selectable', 'unsupported', 'levels', true, ['low', 'medium', 'high', 'xhigh'], 'medium'],
      ['gpt-5.6-luna', 256_000, 'selectable', 'unsupported', 'levels', true, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['gpt-5.6-sol', 256_000, 'selectable', 'unsupported', 'levels', true, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['gpt-5.6-terra', 256_000, 'selectable', 'unsupported', 'levels', true, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['gemini-3.1-pro-preview', 200_000, 'selectable', 'unsupported', 'levels', false, ['low', 'medium', 'high'], 'medium'],
      ['gemini-3.5-flash', 1_000_000, 'fixed', 'unsupported', 'levels', false, ['low', 'medium', 'high'], 'medium'],
      ['kimi-k2.7-code', 256_000, 'unsupported', 'unsupported', 'unknown', false, [], 'on'],
    ]);
    const copilot = catalog.surfaces.get('github-copilot')?.surface;
    expect(copilot?.models.find((model) => model.modelId === 'claude-opus-4.6')).toMatchObject({
      availability: 'unavailable',
      unavailableReason: expect.stringContaining('subscription'),
    });
    expect(copilot?.models.find((model) => model.modelId === 'claude-opus-4.8')).toMatchObject({
      controls: { fast: { state: 'unsupported' } },
    });
    expect(copilot?.models.find((model) => model.modelId === 'claude-opus-4.8')?.executionBindings ?? [])
      .toEqual([]);
    expect(copilot?.models.find((model) => model.modelId === 'claude-opus-4.8-fast')).toMatchObject({
      selection: { pickerVisibility: 'primary' },
      presencePolicy: 'account-entitled',
    });

    verify('grok-account', [
      ['grok-4.20-0309-non-reasoning', 1_000_000, 'fixed', 'unsupported', 'unknown', false, [], 'off'],
      ['grok-4.20-0309-reasoning', 1_000_000, 'fixed', 'unsupported', 'always-on', false, [], 'on'],
      ['grok-4.20-multi-agent-0309', 1_000_000, 'fixed', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'xhigh'], 'medium'],
      ['grok-4.3', 500_000, 'selectable', 'unsupported', 'levels', true, ['low', 'medium', 'high'], 'medium'],
      ['grok-4.6', 500_000, 'unsupported', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'xhigh'], 'high'],
      ['grok-4.5', 500_000, 'unsupported', 'unsupported', 'levels', false, ['low', 'medium', 'high'], 'medium'],
      ['grok-build-0.1', 256_000, 'unsupported', 'unsupported', 'always-on', false, [], 'on'],
    ]);
    const grokSurface = catalog.surfaces.get('grok-account')?.surface;
    expect(grokSurface?.models.find((model) => model.modelId === 'grok-4.20-0309-reasoning')?.controls.reasoning)
      .toMatchObject({ kind: 'always-on', wireProfile: { kind: 'none' } });
    expect(grokSurface?.models.find((model) => model.modelId === 'grok-build-0.1')?.controls.reasoning)
      .toMatchObject({ kind: 'always-on', wireProfile: { kind: 'none' } });
    expect(grokSurface?.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        baseUrl: 'https://cli-chat-proxy.grok.com/v1',
        headers: { 'x-grok-client-version': '0.2.101' },
      }),
    ]));

    verify('deepseek', [
      ['deepseek-flash', 1_000_000, 'fixed', 'unsupported', 'levels', true, ['low', 'high', 'max'], 'high'],
    ]);
    const deepseek = catalog.surfaces.get('deepseek')?.surface;
    expect(deepseek?.discovery).toMatchObject({ authority: 'candidate-validation', strategy: { kind: 'json-catalog' } });
    expect(deepseek?.models.map((model) => model.modelId)).toEqual(['deepseek-flash']);
    expect(deepseek?.models.every((model) => model.aliases.length === 0)).toBe(true);

    verify('kimi-coding-plan', [
      ['kimi-for-coding', 256_000, 'unsupported', 'selectable', 'always-on', false, [], 'on'],
      ['k3', 256_000, 'selectable', 'unsupported', 'levels', false, ['low', 'high', 'max'], 'high'],
      ['k3-256k', 256_000, 'unsupported', 'unsupported', 'levels', false, ['low', 'high', 'max'], 'high'],
      ['kimi-for-coding-highspeed', 256_000, 'unsupported', 'unsupported', 'always-on', false, [], 'on', 'internal'],
    ]);

    verify('volcengine-coding-plan', [
      ['doubao-seed-2.1-turbo', 131_072, 'unsupported', 'unsupported', 'levels', true, ['minimal', 'low', 'medium', 'high'], 'medium'],
      ['glm-5.3', 1_000_000, 'fixed', 'unsupported', 'levels', true, ['high', 'max'], 'high'],
      ['glm-5.2', 1_000_000, 'fixed', 'unsupported', 'levels', true, ['high', 'max'], 'high'],
      ['kimi-k2.7-code', 256_000, 'unsupported', 'selectable', 'always-on', false, [], 'on'],
      ['kimi-k2.7-code-highspeed', 256_000, 'unsupported', 'unsupported', 'always-on', false, [], 'on', 'internal'],
      ['minimax-m3', 204_800, 'unsupported', 'unsupported', 'unknown', false, [], 'on'],
    ]);

    verify('cline-pass', [
      ['cline-pass/glm-5.3', 200_000, 'unsupported', 'unsupported', 'levels', true, ['high', 'max'], 'high'],
      ['cline-pass/glm-5.3-flash', 200_000, 'unsupported', 'unsupported', 'levels', true, ['high', 'max'], 'high'],
      ['cline-pass/glm-5.2', 200_000, 'unsupported', 'unsupported', 'levels', true, ['high', 'max'], 'high'],
      ['cline-pass/kimi-k3', 256_000, 'unsupported', 'unsupported', 'levels', false, ['low', 'high', 'max'], 'high'],
      ['cline-pass/kimi-k2.7-code', 256_000, 'unsupported', 'unsupported', 'always-on', false, [], 'on'],
      ['cline-pass/kimi-k2.6', 256_000, 'unsupported', 'unsupported', 'toggle', true, [], 'on'],
      ['cline-pass/deepseek-v4.1-flash', 1_000_000, 'fixed', 'unsupported', 'levels', false, ['high', 'max'], 'high'],
      ['cline-pass/qwen3.8-max', 1_000_000, 'fixed', 'unsupported', 'unknown', false, [], 'on'],
      ['cline-pass/qwen3.7-plus', 128_000, 'unsupported', 'unsupported', 'unknown', false, [], 'on'],
    ]);
    const volcengine = catalog.surfaces.get('volcengine-coding-plan')?.surface;
    for (const modelId of ['doubao-seed-2.0-code', 'doubao-seed-code', 'minimax-m2.5', 'kimi-k2.5', 'glm-5.1', 'glm-4.7', 'deepseek-v4-flash', 'deepseek-v4-pro']) {
      expect(volcengine?.models.find((model) => model.modelId === modelId), modelId).toBeUndefined();
    }
    expect(volcengine?.models.find((model) => model.modelId === 'kimi-k2.7-code')).toMatchObject({
      availability: 'available',
      executionBindings: [{
        actions: [{ kind: 'model-switch', targetModelId: 'kimi-k2.7-code-highspeed' }],
      }],
    });
    expect(volcengine?.models.find((model) => model.modelId === 'kimi-k2.7-code-highspeed')).toMatchObject({
      availability: 'available',
      selection: { pickerVisibility: 'internal' },
    });
  });

  it('compiles Opus 5 direct Fast and DeepSeek V4.1 Flash protocol-specific controls without aliases', () => {
    const catalog = compileProviderCatalog(input());
    const opus5 = catalog.surfaces.get('anthropic')?.surface.models
      .find((model) => model.modelId === 'claude-opus-5');
    expect(opus5).toMatchObject({
      contextTiers: [expect.objectContaining({ maxPromptTokens: 1_000_000, maxOutputTokens: 128_000 })],
      cost: { input: 5, output: 25 },
      controls: {
        fast: { state: 'selectable', entitlement: 'unknown' },
        reasoning: {
          supportsOff: true,
          levels: ['low', 'medium', 'high', 'xhigh', 'max'],
          defaultSelection: 'high',
        },
      },
      executionBindings: [expect.objectContaining({
        actions: [
          { kind: 'request-patch', patch: { speed: 'fast' } },
          { kind: 'request-headers', headers: { 'anthropic-beta': 'fast-mode-2026-02-01' } },
        ],
      })],
    });

    const deepseek = catalog.surfaces.get('deepseek')?.surface;
    const flash = deepseek?.models.find((model) => model.modelId === 'deepseek-flash');
    expect(flash?.route.protocol).toBe('OpenAIResponses');
    expect(flash?.visionInput.state).toBe('supported');
    expect(flash?.routeOptions?.map((option) => option.route.protocol)).toEqual([
      'OpenAIResponses', 'OpenAICompatibleChatCompletions', 'AnthropicMessages',
    ]);
    expect(deepseek?.models).toHaveLength(1);
    expect(deepseek?.models.every((model) => model.aliases.length === 0)).toBe(true);
    expect(deepseek?.routes.map((route) => ({
      protocol: route.protocol,
      artifactScope: route.contracts.toolLoop.artifactScope,
    }))).toEqual([
      { protocol: 'OpenAIResponses', artifactScope: 'all-assistant-turns' },
      { protocol: 'OpenAICompatibleChatCompletions', artifactScope: 'all-assistant-turns' },
      { protocol: 'AnthropicMessages', artifactScope: 'all-assistant-turns' },
    ]);
  });

  it('requires explicit typed connection schemas instead of a runtime API-key fallback', () => {
    const catalog = compileProviderCatalog(input());
    for (const { surface } of catalog.surfaces.values()) {
      if (surface.status === 'stable' && surface.authModes.includes('api-key')) {
        expect(surface.connectionSchema, surface.id).toBeDefined();
      }
    }

    const broken = clone(input());
    delete mutableSurface(broken, 'openai').connectionSchema;
    expect(() => compileProviderCatalog(broken)).toThrow(/explicit API-key connection schema/u);
  });

  it('fails closed on unknown fields, unregistered implementations, missing targets, and selector conflicts', () => {
    const unknownField = clone(input());
    mutableSurface(unknownField, 'openai').unexpected = true;
    expect(() => compileProviderCatalog(unknownField)).toThrow();

    const missingAdapter = clone(input());
    mutableSurface(missingAdapter, 'openai').routes[0].adapterId = 'not-registered';
    mutableSurface(missingAdapter, 'openai').adapterIds = ['not-registered'];
    expect(() => compileProviderCatalog(missingAdapter)).toThrow(/no registered adapter/u);

    const wrongAdapterProtocol = clone(input());
    mutableSurface(wrongAdapterProtocol, 'openai').routes[0].adapterId = 'anthropic-messages';
    mutableSurface(wrongAdapterProtocol, 'openai').adapterIds = ['anthropic-messages'];
    expect(() => compileProviderCatalog(wrongAdapterProtocol)).toThrow(/does not implement OpenAIResponses/u);

    const missingAuth = clone(input());
    mutableSurface(missingAuth, 'openai').authSchemaId = 'not-registered';
    expect(() => compileProviderCatalog(missingAuth)).toThrow();

    const missingDiscovery = clone(input());
    mutableSurface(missingDiscovery, 'openai').discoveryPolicyId = 'not-registered';
    expect(() => compileProviderCatalog(missingDiscovery)).toThrow();

    const missingProfile = clone(input());
    mutableSurface(missingProfile, 'openai').profileId = 'not-registered';
    expect(() => compileProviderCatalog(missingProfile)).toThrow(/unknown profile/u);

    const subMillionMax = clone(input());
    const gemini = mutableSurface(subMillionMax, 'github-copilot').models
      .find((model: Record<string, unknown>) => model.modelId === 'gemini-3.1-pro-preview');
    gemini.contextTiers.find((tier: Record<string, unknown>) => tier.id === 'one-million')
      .maxPromptTokens = 200_000;
    expect(() => compileProviderCatalog(subMillionMax)).toThrow(/Max mode control references a tier that is not larger than the default context window/u);

    const missingLiveDefaultTier = clone(input());
    mutableSurface(missingLiveDefaultTier, 'kimi-coding-plan').models
      .find((model: Record<string, unknown>) => model.modelId === 'k3')
      .liveProjection.context.observedTierId = 'missing-default';
    expect(() => compileProviderCatalog(missingLiveDefaultTier)).toThrow(/missing observed tier/u);

    const missingLiveMaxTier = clone(input());
    mutableSurface(missingLiveMaxTier, 'kimi-coding-plan').models
      .find((model: Record<string, unknown>) => model.modelId === 'k3')
      .liveProjection.context.maxTierId = 'missing-max';
    expect(() => compileProviderCatalog(missingLiveMaxTier)).toThrow(/invalid Max tier/u);

    const unavailableLiveProtocol = clone(input());
    mutableSurface(unavailableLiveProtocol, 'kimi-coding-plan').models
      .find((model: Record<string, unknown>) => model.modelId === 'k3')
      .liveProjection.reasoning.wireProfiles.GoogleGemini = { kind: 'gemini-thinking-level', on: 'high', levels: { high: 'high' } };
    expect(() => compileProviderCatalog(unavailableLiveProtocol)).toThrow(/unavailable protocol GoogleGemini/u);


    const missingTarget = clone(input());
    const kimi = mutableSurface(missingTarget, 'kimi-coding-plan');
    kimi.models.find((model: Record<string, unknown>) => model.modelId === 'kimi-for-coding')
      .executionBindings[0].actions[0].targetModelId = 'missing-highspeed';
    expect(() => compileProviderCatalog(missingTarget)).toThrow(/targets missing model/u);

    const conflict = clone(input());
    const conflictKimi = mutableSurface(conflict, 'kimi-coding-plan');
    conflictKimi.models.find((model: Record<string, unknown>) => model.modelId === 'kimi-for-coding')
      .executionBindings.push({
        id: 'fast:conflict',
        when: { fast: true },
        actions: [{ kind: 'request-patch', patch: { service_tier: 'priority' } }],
        entitlement: 'granted',
      });
    expect(() => compileProviderCatalog(conflict)).toThrow(/conflicting bindings/u);

    const overlap = clone(input());
    const overlapKimi = mutableSurface(overlap, 'kimi-coding-plan');
    overlapKimi.models.find((model: Record<string, unknown>) => model.modelId === 'k3')
      .executionBindings.push({
        id: 'context:conflict',
        when: { maxContext: true },
        actions: [{ kind: 'request-patch', patch: { mode: 'normal' } }],
        entitlement: 'granted',
      });
    expect(() => compileProviderCatalog(overlap)).toThrow(/equal-specificity/u);

    const missingRouteMatrix = clone(input());
    delete mutableSurface(missingRouteMatrix, 'longcat').models[0].routeOptions;
    expect(() => compileProviderCatalog(missingRouteMatrix)).toThrow(/model-level route matrix/u);

    const missingFieldFactSource = clone(input());
    mutableSurface(missingFieldFactSource, 'chatgpt-account').models[0].fieldFactSourceIds = {
      'controls.fast': 'missing-fact-source',
    };
    expect(() => compileProviderCatalog(missingFieldFactSource)).toThrow(/references unknown fact source/u);

    const unknownFactField = clone(input());
    mutableSurface(unknownFactField, 'chatgpt-account').models[0].fieldFactSourceIds = {
      guessedWindow: 'rdc-agent:chatgpt-account:0',
    };
    expect(() => compileProviderCatalog(unknownFactField)).toThrow(/maps an unknown fact field/u);

    const missingToolsFact = clone(input());
    const clinePass = mutableSurface(missingToolsFact, 'cline-pass');
    const supportedCline = clinePass.models.find((model: Record<string, unknown>) => (
      (model.toolCalling as { state?: string } | undefined)?.state === 'supported'
    ));
    delete supportedCline.fieldFactSourceIds;
    expect(() => compileProviderCatalog(missingToolsFact)).toThrow(/dedicated tools fact source/u);

    const credentialPatch = clone(input());
    mutableSurface(credentialPatch, 'chatgpt-account').models[0].executionBindings[0].actions = [{
      kind: 'request-patch',
      patch: { authorization: 'Bearer embedded-secret' },
    }];
    expect(() => compileProviderCatalog(credentialPatch)).toThrow(/embed credential material/u);

    const unknownConflictSource = clone(input());
    mutableSurface(unknownConflictSource, 'chatgpt-account').factConflicts = [{
      fieldPath: 'models.gpt-5.6-sol.controls.fast',
      sourceIds: ['rdc-agent:chatgpt-account:0', 'missing-source'],
      status: 'unresolved',
      detail: 'Conflicting observed control state.',
    }];
    expect(() => compileProviderCatalog(unknownConflictSource)).toThrow(/conflict references unknown fact source/u);

    const invalidResolution = clone(input());
    const chatgpt = mutableSurface(invalidResolution, 'chatgpt-account');
    chatgpt.factSources.push({
      id: 'user-control-panel:chatgpt-account:test',
      sourceKind: 'user-control-panel',
      sourceRevision: 'test-observation',
      observedAt: '2026-07-15T00:00:00.000Z',
      refreshedAt: '2026-07-15T00:00:00.000Z',
      surface: 'Codex Desktop',
      surfaceBuild: 'test-build',
      plan: 'test-plan',
    });
    chatgpt.factConflicts = [{
      fieldPath: 'models.gpt-5.6-sol.controls.fast',
      sourceIds: ['rdc-agent:chatgpt-account:0', 'user-control-panel:chatgpt-account:test'],
      status: 'resolved',
      resolutionSourceId: 'missing-source',
      detail: 'The user-observed control panel wins.',
    }];
    expect(() => compileProviderCatalog(invalidResolution)).toThrow(/must select one of its fact sources/u);
  });

  it('does not compile a separate embeddings catalog or leak embeddings onto Agent picker surfaces', () => {
    const catalog = compileProviderCatalog(input());
    expect(catalog).not.toHaveProperty('embeddings');
    expect(catalog.index).not.toHaveProperty('embeddings');
    for (const summary of catalog.index.surfaces) {
      expect(summary).not.toHaveProperty('embeddings');
      for (const model of summary.models) {
        expect(model.modelId.includes('embedding')).toBe(false);
      }
    }
    for (const compiled of catalog.surfaces.values()) {
      expect(compiled.surface).not.toHaveProperty('embeddings');
      for (const model of compiled.surface.models) {
        expect(model.modelId.includes('embedding')).toBe(false);
      }
    }
  });

  it('fails closed when a surface still declares an embeddings block', () => {
    const leaked = clone(input());
    mutableSurface(leaked, 'openai').embeddings = { protocol: 'OpenAICompatibleEmbeddings' };
    expect(() => compileProviderCatalog(leaked)).toThrow();
  });

  it('contains no hard unavailable or TODO placeholder in the stable compiled catalog', () => {
    const catalog = compileProviderCatalog(input());
    for (const { surface } of catalog.surfaces.values()) {
      if (surface.status !== 'stable') continue;
      expect(surface.availability.state, surface.id).not.toBe('unavailable');
      expect(JSON.stringify(surface), surface.id).not.toMatch(/TODO/iu);
      expect(surface.routes.every((route) => route.baseUrl.trim().length > 0), surface.id).toBe(true);
      expect(surface.discovery.strategy !== null || surface.models.length > 0, surface.id).toBe(true);
    }
  });
});
