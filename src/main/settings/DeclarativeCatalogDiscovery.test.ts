import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEffectiveCatalogRequest } from './EffectiveModelResolver';
import { createProviderEntryFromPreset, getProviderPreset } from './ProviderPresetRegistry';
import {
  parseDeclarativeCatalog,
  resolveDeclarativeDiscoveryUrl,
  toDeclarativeCatalogContributions,
} from './DeclarativeCatalogDiscovery';

const fixtureRoot = path.join(__dirname, 'fixtures', 'provider-catalogs');
const cases = [
  ['longcat', ['LongCat-2.0']],
  ['opencode-zen', ['claude-opus-4-8', 'gpt-5.5', 'minimax-m3', 'qwen3.6-plus']],
  ['together-ai', ['openai/gpt-oss-120b', 'Qwen/Qwen3-Coder']],
  ['fireworks-ai', ['accounts/fireworks/models/deepseek-v4-pro']],
  ['novita-ai', ['meta-llama/llama-3.3-70b-instruct']],
  ['synthetic', ['syn:large:text']],
  ['chutes', ['Qwen/Qwen3-32B-TEE']],
  ['lm-studio', ['lmstudio-community/qwen3-coder']],
  ['nvidia-nim', ['deepseek-ai/deepseek-v4-pro']],
  ['github-models', ['openai/gpt-4.1']],
  ['ollama-cloud', ['deepseek-v4-flash']],
] as const;

describe('data-only provider discovery fixtures', () => {
  it.each(cases)('parses %s using only its declarative preset', (providerId, expectedIds) => {
    const preset = getProviderPreset(providerId);
    expect(preset?.discovery?.kind).toBe('json-catalog');
    if (preset?.discovery?.kind !== 'json-catalog') throw new Error(`Missing discovery for ${providerId}`);
    const payload = JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${providerId}.json`), 'utf8')) as unknown;
    const parsed = parseDeclarativeCatalog(preset.discovery, payload);
    expect(parsed.map((model) => model.id)).toEqual(expectedIds);
    expect(toDeclarativeCatalogContributions(parsed, {
      protocol: preset.routes[0].protocol,
      baseUrl: preset.routes[0].baseUrl,
    })).toHaveLength(expectedIds.length);
    expect(resolveDeclarativeDiscoveryUrl(preset.discovery, preset.routes[0].baseUrl)).toMatch(/^https?:\/\//u);
  });

  it('keeps iFlow beta and unavailable without inventing a catalog endpoint', () => {
    expect(getProviderPreset('iflow')).toMatchObject({ status: 'beta', availability: { state: 'unavailable' }, discovery: null });
  });

  it('projects both LongCat chat routes and keeps Zen protocols model-scoped', () => {
    const longcat = createProviderEntryFromPreset('longcat');
    const anthropic = buildEffectiveCatalogRequest({ ...longcat, protocol: 'AnthropicMessages', baseUrl: 'https://api.longcat.chat/anthropic/v1' });
    const chat = buildEffectiveCatalogRequest({ ...longcat, protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://api.longcat.chat/openai/v1' });
    expect(anthropic.fallbackRoute.protocol).toBe('AnthropicMessages');
    expect(chat.fallbackRoute.protocol).toBe('OpenAICompatibleChatCompletions');

    const zen = createProviderEntryFromPreset('opencode-zen');
    const gpt = buildEffectiveCatalogRequest(zen).seed.models.find((model) => model.modelId === 'gpt-5.5');
    expect(gpt?.route).toMatchObject({ protocol: 'OpenAIResponses', source: 'model' });

    const preset = getProviderPreset('opencode-zen');
    if (preset?.discovery?.kind !== 'json-catalog') throw new Error('Missing OpenCode Zen discovery');
    const payload = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'opencode-zen.json'), 'utf8')) as unknown;
    const contributions = toDeclarativeCatalogContributions(
      parseDeclarativeCatalog(preset.discovery, payload),
      { protocol: preset.routes[0].protocol, baseUrl: preset.routes[0].baseUrl },
    );
    expect(contributions.find((model) => model.modelId === 'gpt-5.5')?.route?.protocol).toBe('OpenAIResponses');
    expect(contributions.find((model) => model.modelId === 'claude-opus-4-8')?.route?.protocol).toBe('AnthropicMessages');
    expect(contributions.find((model) => model.modelId === 'qwen3.6-plus')?.route?.protocol).toBe('AnthropicMessages');
    expect(contributions.find((model) => model.modelId === 'minimax-m3')?.route?.protocol).toBe('OpenAICompatibleChatCompletions');
  });

  it('projects documented context and capability metadata without static inference', () => {
    const githubPreset = getProviderPreset('github-models');
    const chutesPreset = getProviderPreset('chutes');
    const fireworksPreset = getProviderPreset('fireworks-ai');
    if (
      githubPreset?.discovery?.kind !== 'json-catalog'
      || chutesPreset?.discovery?.kind !== 'json-catalog'
      || fireworksPreset?.discovery?.kind !== 'json-catalog'
    ) throw new Error('Missing declarative discovery');

    const project = (providerId: string, preset: typeof githubPreset) => {
      if (!preset || preset.discovery?.kind !== 'json-catalog') throw new Error(`Missing ${providerId}`);
      const payload = JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${providerId}.json`), 'utf8')) as unknown;
      return toDeclarativeCatalogContributions(
        parseDeclarativeCatalog(preset.discovery, payload),
        { protocol: preset.routes[0].protocol, baseUrl: preset.routes[0].baseUrl },
      )[0];
    };

    expect(project('github-models', githubPreset)).toMatchObject({
      contextTiers: [{ maxPromptTokens: 1_048_576, maxOutputTokens: 32_768 }],
      toolCalling: { state: 'supported' },
      visionInput: { state: 'supported' },
      structuredOutput: { state: 'supported' },
    });
    expect(project('chutes', chutesPreset)).toMatchObject({
      contextTiers: [{ maxPromptTokens: 40_960, maxOutputTokens: 40_960 }],
      defaultBudgetTokens: 40_960,
      toolCalling: { state: 'supported' },
      visionInput: { state: 'unsupported' },
      structuredOutput: { state: 'supported' },
    });
    expect(project('fireworks-ai', fireworksPreset)).toMatchObject({
      contextTiers: [{ maxTotalTokens: 1_048_576 }],
      toolCalling: { state: 'supported' },
      visionInput: { state: 'unsupported' },
    });
  });
});
