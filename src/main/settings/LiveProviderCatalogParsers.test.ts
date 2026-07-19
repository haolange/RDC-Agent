import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { compileProviderCatalog } from '@shared/provider-catalog/compiler';
import { loadProviderCatalogManifestInput } from '@shared/provider-catalog/nodeManifestLoader';
import {
  mergeParsedLiveCatalogs,
  parseChatGptAccountCatalog,
  parseClaudeAccountCatalog,
  parseClineCatalog,
  parseGrokAccountCatalog,
  parseGrokBuilderCatalog as parseGrokBuilderCatalogWithSurface,
  parseKimiCodeCatalog as parseKimiCodeCatalogWithSurface,
  parseOpenCodeGoCatalog as parseOpenCodeGoCatalogWithSurface,
  parseOpenRouterAccountCatalog as parseOpenRouterAccountCatalogWithSurface,
} from './LiveProviderCatalogParsers';

function fixture(name: string): unknown {
  return JSON.parse(readFileSync(resolve(__dirname, 'fixtures/provider-catalogs', name), 'utf8')) as unknown;
}

const compiledCatalog = compileProviderCatalog(loadProviderCatalogManifestInput(
  resolve(__dirname, '../../shared/provider-catalog/manifests'),
));

function surface(name: string) {
  const entry = compiledCatalog.surfaces.get(name)?.surface;
  if (!entry) throw new Error('Missing compiled Provider surface ' + name);
  return entry;
}

const KIMI_SURFACE = surface('kimi-coding-plan');
const GROK_SURFACE = surface('grok-account');
const parseGrokBuilderCatalog = (payload: unknown) => parseGrokBuilderCatalogWithSurface(payload, GROK_SURFACE);
const OPENCODE_GO_SURFACE = surface('opencode-go');
const OPENROUTER_SURFACE = surface('openrouter');
const parseKimiCodeCatalog = (payload: unknown) => parseKimiCodeCatalogWithSurface(payload, KIMI_SURFACE);
const parseOpenCodeGoCatalog = (payload: unknown) => parseOpenCodeGoCatalogWithSurface(payload, OPENCODE_GO_SURFACE);
const parseOpenRouterAccountCatalog = (payload: unknown) => parseOpenRouterAccountCatalogWithSurface(payload, OPENROUTER_SURFACE);

describe('live Provider Catalog parsers', () => {
  it('admits only exact Kimi Coding Plan product ids and keeps labels manifest-owned', () => {
    const parsed = parseKimiCodeCatalog({ data: [
      {
        id: 'kimi-for-coding', display_name: 'Kimi K2.7 Code', context_length: 256_000,
        supports_reasoning: true, supports_thinking_type: 'only', protocol: 'anthropic',
        supports_tool_call: true,
      },
      {
        id: 'k3', display_name: 'backend-version-name', context_length: 256_000,
        supports_reasoning: true, supports_thinking_type: 'only', protocol: 'openai',
        think_efforts: { valid_efforts: ['low', 'high', 'max'], default_effort: 'max' },
      },
      { id: 'kimi-for-coding-highspeed', context_length: 256_000, supports_reasoning: true },
      { id: 'kimi-k2.7-code', display_name: 'must-not-enter' },
    ] });

    expect(parsed.models.map((model) => [model.id, model.label])).toEqual([
      ['k3', 'Kimi K3'],
      ['kimi-for-coding', 'Kimi for Coding'],
      ['kimi-for-coding-highspeed', 'Kimi for Coding HighSpeed'],
    ]);
    expect(parsed.contributions.find((model) => model.modelId === 'k3')).toMatchObject({
      controls: {
        fast: { state: 'unsupported', fixedValue: false },
        context1m: { state: 'selectable', tierId: 'max' },
        reasoning: {
          kind: 'levels', supportsOff: false, levels: ['low', 'high', 'max'], defaultSelection: 'max',
        },
      },
      executionBindings: [{
        id: 'context:max',
        actions: [{ kind: 'model-switch', targetModelId: 'k3[1m]' }],
      }],
    });
    expect(parsed.contributions.find((model) => model.modelId === 'kimi-for-coding')).toMatchObject({
      controls: { fast: { state: 'selectable', entitlement: 'unknown' } },
      executionBindings: expect.arrayContaining([
        expect.objectContaining({
          actions: [{ kind: 'model-switch', targetModelId: 'kimi-for-coding-highspeed' }],
        }),
      ]),
    });
    expect(parsed.contributions.find((model) => model.modelId === 'kimi-for-coding-highspeed'))
      .toMatchObject({ selection: { pickerVisibility: 'internal' } });
  });

  it('projects Kimi K3 single-effort and unknown metadata without inventing Off or Fast', () => {
    const maxOnly = parseKimiCodeCatalog({ models: [{
      id: 'k3', context_length: 256_000, supports_reasoning: true,
      think_efforts: { valid_efforts: ['max'], default_effort: 'max' },
    }] }).contributions[0];
    expect(maxOnly).toMatchObject({
      controls: {
        fast: { state: 'unsupported', fixedValue: false },
        context1m: { state: 'selectable', entitlement: 'unknown', tierId: 'max' },
        reasoning: { kind: 'always-on', supportsOff: false, levels: ['max'], defaultSelection: 'max' },
      },
    });

    const unknown = parseKimiCodeCatalog({ data: [{ id: 'k3', context_length: 256_000 }] })
      .contributions[0];
    expect(unknown?.controls?.reasoning).toMatchObject({
      kind: 'unknown', supportsOff: false, defaultState: 'provider-managed',
    });
    expect(() => parseKimiCodeCatalog({ unexpected: [] })).toThrow(/missing a data or models array/u);
  });
  it('keeps structural context and unknown protocol observations fail-closed', () => {
    const modelCatalogSurface = structuredClone(KIMI_SURFACE);
    const k3 = modelCatalogSurface.models.find((model) => model.modelId === 'k3');
    if (!k3?.liveProjection?.context) throw new Error('Missing K3 live context policy fixture.');
    k3.liveProjection.context.observedTierId = 'max';
    k3.liveProjection.context.entitlementAuthority = 'manifest';

    const contribution = parseKimiCodeCatalogWithSurface({ data: [{
      id: 'k3',
      protocol: 'unrecognized-wire',
      context_length: 1_000_000,
      supports_reasoning: true,
    }] }, modelCatalogSurface).contributions[0];

    expect(contribution.route).toMatchObject(k3.route);
    expect(contribution.route?.contracts?.reasoning).toMatchObject({ semantic: 'raw', displayLabel: 'Raw reasoning' });
    expect(contribution.controls?.context1m).toMatchObject({
      state: 'selectable',
      defaultValue: false,
      entitlement: 'unknown',
    });
    expect(contribution.controls?.reasoning).toMatchObject({ kind: 'unknown', supportsOff: false });
  });
  it('preserves OpenCode Go per-model protocols', () => {
    const parsed = parseOpenCodeGoCatalog(fixture('opencode-go.json'));
    expect(Object.fromEntries(parsed.contributions.map((model) => [model.modelId, model.route?.protocol]))).toEqual({
      'glm-4.7': 'OpenAICompatibleChatCompletions',
      'gpt-5.4': 'OpenAIResponses',
      'minimax-m2.5': 'AnthropicMessages',
    });
    expect(parsed.contributions.every((model) => model.route?.source === 'catalog')).toBe(true);
  });

  it('projects Kimi K3 only from exact OpenCode Go and OpenRouter live rows', () => {
    const openCode = parseOpenCodeGoCatalog({ data: [{
      id: 'kimi-k3',
      endpoint: '/chat/completions',
      context_length: 1_000_000,
    }] });
    expect(openCode.contributions[0]).toMatchObject({
      modelId: 'kimi-k3',
      label: 'Kimi K3',
      defaultBudgetTokens: 256_000,
      controls: {
        fast: { state: 'unsupported', fixedValue: false },
        context1m: { state: 'selectable', tierId: 'max' },
        reasoning: {
          kind: 'always-on', supportsOff: false, defaultSelection: 'max', lockedSelection: 'max',
        },
      },
    });

    const openRouter = parseOpenRouterAccountCatalog({ data: [{
      id: 'moonshotai/kimi-k3',
      name: 'Moonshot backend display',
      context_length: 1_000_000,
      supported_parameters: ['tools'],
    }] });
    expect(openRouter.contributions[0]).toMatchObject({
      modelId: 'moonshotai/kimi-k3',
      label: 'Kimi K3',
      defaultBudgetTokens: 256_000,
      controls: {
        fast: { state: 'unsupported', fixedValue: false },
        context1m: { state: 'selectable', tierId: 'max' },
        reasoning: {
          kind: 'always-on', supportsOff: false, defaultSelection: 'max', lockedSelection: 'max',
        },
      },
    });
    expect(parseOpenRouterAccountCatalog({ data: [{
      id: 'moonshotai/kimi-k2.7-code', context_length: 256_000,
    }] }).contributions[0]?.controls).toBeUndefined();
  });
  it('uses explicit ClinePass groups only as entitlement evidence', () => {
    const parsed = parseClineCatalog(fixture('cline.json'));
    expect(parsed.entitlementContributions).toEqual([expect.objectContaining({
      modelId: 'anthropic/claude-sonnet-4.6',
      contextTiers: [{ id: 'default', label: 'ClinePass', entitlement: 'granted' }],
    })]);
  });

  it('projects OpenRouter live metadata on the OpenRouter route', () => {
    const source = fixture('openrouter-pkce.json') as { models: unknown };
    expect(parseOpenRouterAccountCatalog(source.models).contributions).toEqual([
      expect.objectContaining({
        modelId: 'anthropic/claude-sonnet-4.6',
        route: expect.objectContaining({ protocol: 'OpenRouterChatCompletions', baseUrl: 'https://openrouter.ai/api/v1', source: 'catalog' }),
        contextTiers: [expect.objectContaining({ maxPromptTokens: 1_000_000 })],
        toolCalling: { state: 'supported' },
        visionInput: { state: 'supported' },
        structuredOutput: { state: 'supported' },
      }),
    ]);
  });

  it('parses account-visible ChatGPT ids without duplicating manifest controls', () => {
    const parsed = parseChatGptAccountCatalog(fixture('chatgpt-account.json'));
    expect(parsed.models.map((model) => model.id)).toEqual([
      'gpt-5.3-codex-spark',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.5',
      'gpt-5.6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
    ]);
    const sol = parsed.contributions.find((model) => model.modelId === 'gpt-5.6-sol');
    expect(sol).toMatchObject({
      availability: 'available',
      defaultBudgetTokens: 256_000,
      contextTiers: [{ id: 'default', maxPromptTokens: 256_000 }],
    });
    expect(sol?.controls).toBeUndefined();
    expect(sol?.executionBindings).toBeUndefined();
    expect(parsed.contributions.find((model) => model.modelId === 'gpt-5.4')?.contextTiers).toEqual([
      expect.objectContaining({ id: 'default', maxPromptTokens: 256_000, entitlement: 'granted' }),
      expect.objectContaining({ id: 'max', maxPromptTokens: 1_000_000, entitlement: 'unknown' }),
    ]);
  });

  it('keeps future account models structurally unknown while accepting explicit live windows', () => {
    const parsed = parseChatGptAccountCatalog({ models: [{
      slug: 'future-live-model', visibility: 'list', supported_in_api: true,
      context_window: 256_000, max_context_window: 1_000_000,
    }] });
    expect(parsed.contributions[0]).toMatchObject({
      modelId: 'future-live-model',
      contextTiers: [
        { id: 'default', maxPromptTokens: 256_000 },
        { id: 'max', maxPromptTokens: 1_000_000, entitlement: 'unknown' },
      ],
    });
    expect(parsed.contributions[0].controls).toBeUndefined();
  });

  it('uses the Claude account endpoint only as identity and entitlement evidence', () => {
    const parsed = parseClaudeAccountCatalog(fixture('claude-account.json'));
    expect(parsed.models.map((model) => model.id)).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);
    expect(parsed.contributions[0].contextTiers).toBeUndefined();
    expect(parsed.contributions[0].controls).toBeUndefined();
  });

  it('merges Grok API and Builder surfaces without collapsing independent models', () => {
    const parsed = mergeParsedLiveCatalogs(
      parseGrokAccountCatalog(fixture('grok-account.json')),
      parseGrokBuilderCatalog(fixture('grok-builder.json')),
    );
    expect(parsed.models.map((model) => model.id)).toEqual([
      'grok-4.20-0309-non-reasoning',
      'grok-4.20-0309-reasoning',
      'grok-4.20-multi-agent-0309',
      'grok-4.3',
      'grok-4.5',
      'grok-composer-2.5-fast',
    ]);
    expect(parsed.contributions.find((model) => model.modelId === 'grok-4.3')).toMatchObject({
      contextTiers: [expect.objectContaining({ id: 'default', maxPromptTokens: 1_000_000 })],
      defaultBudgetTokens: 1_000_000,
    });
    expect(parsed.contributions.find((model) => model.modelId === 'grok-4.3'))
      .not.toHaveProperty('route');
    expect(parsed.contributions.find((model) => model.modelId === 'grok-4.5')).toMatchObject({
      route: { protocol: 'OpenAIResponses', baseUrl: 'https://cli-chat-proxy.grok.com/v1' },
      controls: { reasoning: { levels: ['low', 'medium', 'high'] } },
    });
    expect(parsed.contributions.find((model) => model.modelId === 'grok-4.5')?.controls?.fast)
      .toEqual({ state: 'unsupported', fixedValue: false });
    expect(parsed.contributions.find((model) => model.modelId === 'grok-4.20-0309-reasoning')?.controls)
      .toBeUndefined();
  });

  it('admits Composer 2.5 from every supported Builder envelope without inventing Fast mode', () => {
    const composer = {
      id: 'grok-composer-2.5-fast',
      name: 'Composer 2.5',
      api_backend: 'responses',
      context_window: 200_000,
      supported_in_api: true,
      supports_reasoning_effort: false,
    };
    const payloads = [
      { expectedEnvelope: 'models-map', payload: { models: { [composer.id]: { info: composer } } } },
      { expectedEnvelope: 'models-array', payload: { models: [{ info: composer }] } },
      { expectedEnvelope: 'data-array', payload: { data: [{ info: composer }] } },
      { expectedEnvelope: 'items-array', payload: { items: [{ info: composer }] } },
    ];

    for (const { expectedEnvelope, payload } of payloads) {
      const parsed = parseGrokBuilderCatalog(payload);
      expect(parsed.diagnostic).toMatchObject({
        envelopeKind: expectedEnvelope,
        candidateCount: 1,
        admittedCount: 1,
        filtered: { invalidIdentity: 0, hidden: 0, unsupportedInApi: 0 },
      });
      expect(parsed.contributions).toEqual([expect.objectContaining({
        modelId: 'grok-composer-2.5-fast',
        label: 'Composer 2.5',
        selection: { pickerVisibility: 'primary' },
        defaultBudgetTokens: 200_000,
        controls: expect.objectContaining({
          fast: { state: 'unsupported', fixedValue: false },
          context1m: { state: 'unsupported', fixedValue: false },
        }),
      })]);

    }
  });
  it('filters media models and canonicalizes proven aliases', () => {
    const parsed = parseGrokAccountCatalog({ data: [
      { id: 'grok-4.3', context_window: 1_000_000 },
      { id: 'grok-latest', type: 'alias', canonical_id: 'grok-4.3', context_window: 1_000_000 },
      { id: 'grok-image-1', modality: 'image' },
      { id: 'grok-imagine-video-1.5', output_modalities: ['video'] },
    ] });
    expect(parsed.models).toEqual([{
      id: 'grok-4.3', label: 'grok-4.3', enabled: true, aliases: ['grok-latest'],
    }]);
  });
});
