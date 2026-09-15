import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildEffectiveCatalogRequest } from './EffectiveModelResolver';
import { mergeEffectiveCatalog } from './effectiveCatalogMerge';
import {
  createProviderEntryFromCatalog,
  getLoadedProviderSurface,
  loadProviderSurface,
} from '../provider-catalog/ProviderCatalogRegistry';
import {
  parseDeclarativeCatalog,
  resolveDeclarativeDiscoveryUrl,
  toDeclarativeCatalogContributions,
} from './DeclarativeCatalogDiscovery';

const fixtureRoot = path.join(__dirname, 'fixtures', 'provider-catalogs');
const cases = [
  ['longcat', ['LongCat-2.0']],
  ['opencode-zen', ['claude-opus-4-8', 'gemini-3.5-flash', 'gpt-5.5', 'minimax-m3', 'qwen3.6-plus']],
  ['together-ai', ['openai/gpt-oss-120b', 'Qwen/Qwen3-Coder']],
  ['fireworks-ai', ['accounts/fireworks/models/deepseek-v4-pro']],
  ['novita-ai', ['meta-llama/llama-3.3-70b-instruct']],
  ['synthetic', ['syn:large:text']],
  ['chutes', ['Qwen/Qwen3-32B-TEE']],
  ['lm-studio', ['lmstudio-community/qwen3-coder']],
  ['nvidia-nim', ['deepseek-ai/deepseek-v4-pro']],
  ['github-models', ['openai/gpt-4.1']],
  ['ollama-cloud', ['deepseek-v4.1-flash']],
] as const;

describe('data-only provider discovery fixtures', () => {
  beforeAll(async () => {
    await Promise.all([
      ...cases.map(([providerId]) => loadProviderSurface(providerId)),
      loadProviderSurface('iflow'),
      loadProviderSurface('deepseek'),
    ]);
  });

  it.each(cases)('parses %s using only its declarative manifest', (providerId, expectedIds) => {
    const surface = getLoadedProviderSurface(providerId);
    const discovery = surface?.discovery.strategy;
    expect(discovery?.kind).toBe('json-catalog');
    if (!surface || discovery?.kind !== 'json-catalog') throw new Error(`Missing discovery for ${providerId}`);
    const payload = JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${providerId}.json`), 'utf8')) as unknown;
    const parsed = parseDeclarativeCatalog(discovery, payload);
    expect(parsed.map((model) => model.id)).toEqual(expectedIds);
    expect(toDeclarativeCatalogContributions(parsed, {
      protocol: surface.routes[0].protocol,
      baseUrl: surface.routes[0].baseUrl,
    })).toHaveLength(expectedIds.length);
    expect(resolveDeclarativeDiscoveryUrl(discovery, surface.routes[0].baseUrl)).toMatch(/^https?:\/\//u);
  });

  it('keeps the pinned iFlow compatible surface discoverable without claiming credential availability', () => {
    expect(getLoadedProviderSurface('iflow')).toMatchObject({
      status: 'stable',
      availability: { state: 'unknown' },
      discovery: { strategy: { kind: 'custom-parser', parserId: 'openai-compatible' } },
      routes: [expect.objectContaining({
        protocol: 'OpenAICompatibleChatCompletions',
        baseUrl: 'https://apis.iflow.cn/v1',
      })],
    });
  });

  it('projects both LongCat chat routes and keeps Zen protocols model-scoped', () => {
    const longcat = createProviderEntryFromCatalog('longcat');
    const anthropic = buildEffectiveCatalogRequest({ ...longcat, protocol: 'AnthropicMessages', baseUrl: 'https://api.longcat.chat/anthropic/v1' });
    const chat = buildEffectiveCatalogRequest({ ...longcat, protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://api.longcat.chat/openai/v1' });
    expect(anthropic.fallbackRoute.protocol).toBe('AnthropicMessages');
    expect(chat.fallbackRoute.protocol).toBe('OpenAICompatibleChatCompletions');

    const zen = createProviderEntryFromCatalog('opencode-zen');
    const gpt = buildEffectiveCatalogRequest(zen).catalog.models.find((model) => model.modelId === 'gpt-5.5');
    expect(gpt?.route).toMatchObject({ protocol: 'OpenAIResponses', source: 'model' });

    const surface = getLoadedProviderSurface('opencode-zen');
    const discovery = surface?.discovery.strategy;
    if (!surface || discovery?.kind !== 'json-catalog') throw new Error('Missing OpenCode Zen discovery');
    const payload = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'opencode-zen.json'), 'utf8')) as unknown;
    const contributions = toDeclarativeCatalogContributions(
      parseDeclarativeCatalog(discovery, payload),
      { protocol: surface.routes[0].protocol, baseUrl: surface.routes[0].baseUrl },
    );
    expect(contributions.find((model) => model.modelId === 'gpt-5.5')?.route?.protocol).toBe('OpenAIResponses');
    expect(contributions.find((model) => model.modelId === 'claude-opus-4-8')?.route?.protocol).toBe('AnthropicMessages');
    expect(contributions.find((model) => model.modelId === 'qwen3.6-plus')?.route?.protocol).toBe('AnthropicMessages');
    expect(contributions.find((model) => model.modelId === 'minimax-m3')?.route?.protocol).toBe('OpenAICompatibleChatCompletions');
    expect(contributions.find((model) => model.modelId === 'gemini-3.5-flash')?.route?.protocol).toBe('OpenAICompatibleChatCompletions');
  });

  it('treats a protocol-less candidate list as availability evidence without replacing model-owned routes', () => {
    const provider = createProviderEntryFromCatalog('deepseek');
    const request = buildEffectiveCatalogRequest({
      ...provider,
      protocol: 'OpenAIResponses',
      baseUrl: 'https://api.deepseek.com',
    });
    const surface = getLoadedProviderSurface('deepseek');
    const discovery = surface?.discovery.strategy;
    if (!surface || discovery?.kind !== 'json-catalog') throw new Error('Missing DeepSeek discovery');
    const parsed = parseDeclarativeCatalog(discovery, {
      data: [
        { id: 'deepseek-flash' },
      ],
    });
    const contributions = toDeclarativeCatalogContributions(parsed, {
      protocol: 'OpenAIResponses',
      baseUrl: 'https://api.deepseek.com',
    });

    expect(contributions.every((model) => model.route === undefined)).toBe(true);
    const staleFallbackContributions = contributions.map((model) => ({
      ...model,
      route: {
        protocol: 'OpenAIResponses' as const,
        baseUrl: 'https://api.deepseek.com',
        source: 'catalog' as const,
      },
    }));
    const models = mergeEffectiveCatalog({
      ...request,
      discovery: {
        source: 'discovery',
        observedAt: '2026-08-01T00:00:00.000Z',
        models: staleFallbackContributions,
      },
    });
    expect(models.find((model) => model.modelId === 'deepseek-flash')?.route.protocol)
      .toBe('OpenAIResponses');
  });

  it('projects documented context and capability metadata without static inference', () => {
    const githubSurface = getLoadedProviderSurface('github-models');
    const chutesSurface = getLoadedProviderSurface('chutes');
    const fireworksSurface = getLoadedProviderSurface('fireworks-ai');
    if (
      githubSurface?.discovery.strategy?.kind !== 'json-catalog'
      || chutesSurface?.discovery.strategy?.kind !== 'json-catalog'
      || fireworksSurface?.discovery.strategy?.kind !== 'json-catalog'
    ) throw new Error('Missing declarative discovery');

    const project = (providerId: string, surface: typeof githubSurface) => {
      const discovery = surface?.discovery.strategy;
      if (!surface || discovery?.kind !== 'json-catalog') throw new Error(`Missing ${providerId}`);
      const payload = JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${providerId}.json`), 'utf8')) as unknown;
      return toDeclarativeCatalogContributions(
        parseDeclarativeCatalog(discovery, payload),
        { protocol: surface.routes[0].protocol, baseUrl: surface.routes[0].baseUrl },
      )[0];
    };

    expect(project('github-models', githubSurface)).toMatchObject({
      contextTiers: [{ maxPromptTokens: 1_048_576, maxOutputTokens: 32_768, entitlement: 'unknown' }],
      controls: { maxContext: { state: 'unknown', defaultValue: false } },
      toolCalling: { state: 'supported' },
      visionInput: { state: 'supported' },
      structuredOutput: { state: 'supported' },
    });
    expect(project('chutes', chutesSurface)).toMatchObject({
      contextTiers: [{ maxPromptTokens: 40_960, maxOutputTokens: 40_960 }],
      defaultBudgetTokens: 40_960,
      toolCalling: { state: 'supported' },
      visionInput: { state: 'unsupported' },
      structuredOutput: { state: 'supported' },
    });
    expect(project('fireworks-ai', fireworksSurface)).toMatchObject({
      contextTiers: [{ maxTotalTokens: 1_048_576 }],
      toolCalling: { state: 'supported' },
      visionInput: { state: 'unsupported' },
    });
    expect(project('fireworks-ai', fireworksSurface).contextTiers?.[0]).not.toHaveProperty('maxOutputTokens');
  });
});
