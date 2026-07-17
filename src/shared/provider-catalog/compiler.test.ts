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

  it('keeps Kimi maintained discovery and the Fast target as one execution binding truth', () => {
    const catalog = compileProviderCatalog(input());
    const surface = catalog.surfaces.get('kimi-coding-plan')?.surface;
    expect(catalog.index.surfaces.find((entry) => entry.id === 'kimi-coding-plan')).toMatchObject({
      discoveryAuthority: 'candidate-validation',
      modelCount: 1,
    });
    expect(surface?.discovery.authority).toBe('candidate-validation');
    expect(surface?.models.map((model) => model.modelId)).toEqual([
      'kimi-for-coding',
      'kimi-for-coding-highspeed',
    ]);
    expect(surface?.models.every((model) => model.presencePolicy === 'maintained')).toBe(true);
    expect(surface?.models.find((model) => model.modelId === 'kimi-for-coding')).toMatchObject({
      controls: { fast: { state: 'selectable' } },
      executionBindings: [{
        when: { fast: true },
        actions: [{ kind: 'model-switch', targetModelId: 'kimi-for-coding-highspeed' }],
      }],
    });
    expect(surface?.models.find((model) => model.modelId === 'kimi-for-coding-highspeed')?.selection)
      .toEqual({ pickerVisibility: 'internal', relatedPrimaryModelIds: ['kimi-for-coding'] });
    expect(surface?.models.filter((model) => model.selection.pickerVisibility === 'primary').map((model) => model.modelId))
      .toEqual(['kimi-for-coding']);
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
      context1m: 'unsupported' | 'selectable' | 'fixed',
      fast: 'unsupported' | 'selectable',
      reasoningKind: 'unknown' | 'toggle' | 'always-on' | 'levels',
      supportsOff: boolean,
      levels: readonly string[],
      defaultSelection: string,
      picker?: 'primary' | 'internal',
    ];
    const verify = (surfaceId: string, rows: readonly ExpectedRow[]) => {
      const surface = catalog.surfaces.get(surfaceId)?.surface;
      expect(surface, surfaceId).toBeDefined();
      for (const [modelId, contextTokens, context1m, fast, reasoningKind, supportsOff, levels, defaultSelection, picker = 'primary'] of rows) {
        const model = surface?.models.find((entry) => entry.modelId === modelId);
        expect(model, `${surfaceId}/${modelId}`).toBeDefined();
        const defaultTier = model?.contextTiers.find((tier) => tier.id === 'default');
        expect(defaultTier?.maxPromptTokens ?? defaultTier?.maxTotalTokens, `${surfaceId}/${modelId} context`)
          .toBe(contextTokens);
        expect(model?.controls.context1m.state, `${surfaceId}/${modelId} 1M`).toBe(context1m);
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
      ['gpt-5.6-sol', 256_000, 'unsupported', 'selectable', 'levels', false, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['gpt-5.6-terra', 256_000, 'unsupported', 'selectable', 'levels', false, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['gpt-5.6-luna', 256_000, 'unsupported', 'selectable', 'levels', false, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['gpt-5.5', 256_000, 'unsupported', 'selectable', 'levels', false, ['low', 'medium', 'high', 'xhigh'], 'medium'],
      ['gpt-5.4-mini', 128_000, 'unsupported', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'xhigh'], 'medium'],
      ['gpt-5.4', 256_000, 'selectable', 'selectable', 'levels', false, ['low', 'medium', 'high', 'xhigh'], 'medium'],
      ['gpt-5.3-codex-spark', 256_000, 'unsupported', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'xhigh'], 'medium'],
    ]);

    verify('github-copilot', [
      ['claude-sonnet-4.6', 1_000_000, 'fixed', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'max'], 'medium'],
      ['claude-opus-4.6', 1_000_000, 'fixed', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'max'], 'medium'],
      ['claude-opus-4.8', 1_000_000, 'fixed', 'selectable', 'levels', false, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['claude-opus-4.8-fast', 1_000_000, 'fixed', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium', 'internal'],
      ['claude-sonnet-5', 1_000_000, 'fixed', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['claude-fable-5', 1_000_000, 'fixed', 'unsupported', 'levels', false, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['gpt-5.4-mini', 128_000, 'unsupported', 'unsupported', 'levels', true, ['low', 'medium', 'high', 'xhigh'], 'medium'],
      ['gpt-5.4', 256_000, 'selectable', 'unsupported', 'levels', true, ['low', 'medium', 'high', 'xhigh'], 'medium'],
      ['gpt-5.5', 256_000, 'selectable', 'unsupported', 'levels', true, ['low', 'medium', 'high', 'xhigh'], 'medium'],
      ['gpt-5.6-luna', 256_000, 'selectable', 'unsupported', 'levels', true, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['gpt-5.6-sol', 256_000, 'selectable', 'unsupported', 'levels', true, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['gpt-5.6-terra', 256_000, 'selectable', 'unsupported', 'levels', true, ['low', 'medium', 'high', 'xhigh', 'max'], 'medium'],
      ['gemini-3.1-pro-preview', 200_000, 'selectable', 'unsupported', 'levels', false, ['low', 'medium', 'high'], 'medium'],
      ['gemini-3.5-flash', 1_000_000, 'fixed', 'unsupported', 'levels', true, ['low', 'medium', 'high'], 'medium'],
      ['kimi-k2.7-code', 256_000, 'unsupported', 'unsupported', 'unknown', false, [], 'on'],
    ]);

    verify('grok-account', [
      ['grok-4.20-0309-non-reasoning', 1_000_000, 'fixed', 'unsupported', 'unknown', false, [], 'off'],
      ['grok-4.20-0309-reasoning', 1_000_000, 'fixed', 'unsupported', 'unknown', false, [], 'off'],
      ['grok-4.20-multi-agent-0309', 1_000_000, 'fixed', 'unsupported', 'unknown', false, [], 'off'],
      ['grok-4.3', 1_000_000, 'fixed', 'unsupported', 'unknown', false, [], 'off'],
      ['grok-4.5', 500_000, 'unsupported', 'unsupported', 'levels', false, ['low', 'medium', 'high'], 'medium'],
      ['grok-build-0.1', 256_000, 'unsupported', 'unsupported', 'unknown', false, [], 'off'],
    ]);
    const grokSurface = catalog.surfaces.get('grok-account')?.surface;
    expect(grokSurface?.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        baseUrl: 'https://cli-chat-proxy.grok.com/v1',
        headers: { 'x-grok-client-version': '0.2.101' },
      }),
    ]));

    verify('deepseek', [
      ['deepseek-v4-pro', 1_000_000, 'fixed', 'unsupported', 'levels', true, ['high', 'max'], 'high'],
      ['deepseek-v4-flash', 1_000_000, 'fixed', 'unsupported', 'levels', true, ['high', 'max'], 'high'],
    ]);
    const deepseek = catalog.surfaces.get('deepseek')?.surface;
    expect(deepseek?.discovery).toMatchObject({ authority: 'candidate-validation', strategy: { kind: 'json-catalog' } });
    expect(deepseek?.models.map((model) => model.modelId)).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash']);
    expect(deepseek?.models.every((model) => model.aliases.length === 0)).toBe(true);

    verify('kimi-coding-plan', [
      ['kimi-for-coding', 256_000, 'unsupported', 'selectable', 'toggle', true, [], 'on'],
      ['kimi-for-coding-highspeed', 256_000, 'unsupported', 'unsupported', 'toggle', true, [], 'on', 'internal'],
    ]);

    verify('volcengine-coding-plan', [
      ['doubao-seed-2.0-lite', 131_072, 'unsupported', 'unsupported', 'levels', true, ['minimal', 'low', 'medium', 'high'], 'medium'],
      ['doubao-seed-2.0-pro', 131_072, 'unsupported', 'selectable', 'levels', true, ['minimal', 'low', 'medium', 'high'], 'medium'],
      ['doubao-seed-2.0-code', 131_072, 'unsupported', 'selectable', 'levels', true, ['minimal', 'low', 'medium', 'high'], 'medium'],
      ['glm-5.2', 1_000_000, 'fixed', 'unsupported', 'levels', false, ['high', 'max'], 'high'],
      ['deepseek-v4-pro', 1_000_000, 'fixed', 'unsupported', 'levels', true, ['high', 'max'], 'high'],
      ['deepseek-v4-flash', 1_000_000, 'fixed', 'unsupported', 'levels', true, ['high', 'max'], 'high'],
      ['kimi-k2.7-code', 256_000, 'unsupported', 'selectable', 'toggle', true, [], 'on'],
      ['kimi-k2.7-code-highspeed', 256_000, 'unsupported', 'unsupported', 'toggle', true, [], 'on', 'internal'],
    ]);
    const volcengine = catalog.surfaces.get('volcengine-coding-plan')?.surface;
    expect(volcengine?.models.find((model) => model.modelId === 'kimi-k2.7-code')).toMatchObject({
      availability: 'unavailable',
      unavailableReason: expect.stringContaining('user-observed'),
      executionBindings: [{
        actions: [{ kind: 'model-switch', targetModelId: 'kimi-k2.7-code-highspeed' }],
      }],
    });
    expect(volcengine?.models.find((model) => model.modelId === 'kimi-k2.7-code-highspeed')).toMatchObject({
      availability: 'unavailable',
      selection: { pickerVisibility: 'internal' },
    });
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
    expect(() => compileProviderCatalog(subMillionMax)).toThrow(/Max mode control references a sub-one-million context tier/u);

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
    overlapKimi.models.find((model: Record<string, unknown>) => model.modelId === 'kimi-for-coding')
      .executionBindings.push({
        id: 'context:conflict',
        when: { context1m: false },
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
