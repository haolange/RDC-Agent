import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEffectiveCatalogRequest } from './EffectiveModelResolver';
import { createProviderEntryFromPreset, getProviderPreset } from './ProviderPresetRegistry';
import { parseDeclarativeCatalog, resolveDeclarativeDiscoveryUrl } from './DeclarativeCatalogDiscovery';

const fixtureRoot = path.join(__dirname, 'fixtures', 'provider-catalogs');
const cases = [
  ['longcat', ['LongCat-2.0']],
  ['opencode-zen', ['claude-opus-4-7', 'gpt-5.5']],
  ['together-ai', ['openai/gpt-oss-120b']],
  ['fireworks-ai', ['accounts/fireworks/models/deepseek-v4-pro']],
  ['novita-ai', ['meta-llama/llama-3.3-70b-instruct']],
  ['synthetic', ['syn:large:text']],
  ['chutes', ['deepseek-ai/DeepSeek-V3.1']],
  ['lm-studio', ['lmstudio-community/qwen3-coder']],
  ['nvidia-nim', ['deepseek-ai/deepseek-v4-pro']],
  ['github-models', ['openai/gpt-4.1']],
  ['ollama-cloud', ['gpt-oss:120b-cloud']],
] as const;

describe('data-only provider discovery fixtures', () => {
  it.each(cases)('parses %s using only its declarative preset', (providerId, expectedIds) => {
    const preset = getProviderPreset(providerId);
    expect(preset?.discovery?.kind).toBe('json-catalog');
    if (preset?.discovery?.kind !== 'json-catalog') throw new Error(`Missing discovery for ${providerId}`);
    const payload = JSON.parse(fs.readFileSync(path.join(fixtureRoot, `${providerId}.json`), 'utf8')) as unknown;
    expect(parseDeclarativeCatalog(preset.discovery, payload).map((model) => model.id)).toEqual(expectedIds);
    expect(resolveDeclarativeDiscoveryUrl(preset.discovery, preset.routes[0].baseUrl)).toMatch(/^https?:\/\//u);
  });

  it('keeps iFlow beta and unavailable without inventing a catalog endpoint', () => {
    expect(getProviderPreset('iflow')).toMatchObject({ status: 'beta', availability: { state: 'unavailable' }, discovery: null });
  });

  it('projects both LongCat routes and keeps Zen GPT models on Responses', () => {
    const longcat = createProviderEntryFromPreset('longcat');
    const anthropic = buildEffectiveCatalogRequest({ ...longcat, protocol: 'AnthropicMessages', baseUrl: 'https://api.longcat.chat/anthropic/v1' });
    const responses = buildEffectiveCatalogRequest({ ...longcat, protocol: 'OpenAIResponses', baseUrl: 'https://api.longcat.chat/openai/v1' });
    expect(anthropic.fallbackRoute.protocol).toBe('AnthropicMessages');
    expect(responses.fallbackRoute.protocol).toBe('OpenAIResponses');

    const zen = createProviderEntryFromPreset('opencode-zen');
    const gpt = buildEffectiveCatalogRequest(zen).seed.models.find((model) => model.modelId === 'gpt-5.5');
    expect(gpt?.route).toMatchObject({ protocol: 'OpenAIResponses', source: 'model' });
  });
});
