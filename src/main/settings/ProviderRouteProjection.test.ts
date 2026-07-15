import { describe, expect, it } from 'vitest';
import { projectModelProtocolOverlays, resolveModelRoutePrecedence } from './ProviderRouteProjection';

describe('provider route projection', () => {
  it('applies an explicit model route before the Catalog default', () => {
    expect(resolveModelRoutePrecedence({
      modelRoute: { protocol: 'AnthropicMessages', baseUrl: 'https://model.test', source: 'catalog' },
      catalogRoute: { protocol: 'OpenAIResponses', baseUrl: 'https://catalog.test' },
    })).toMatchObject({ protocol: 'AnthropicMessages', baseUrl: 'https://model.test', source: 'model' });
  });

  it('retains required Catalog headers across model and user route selection', () => {
    expect(resolveModelRoutePrecedence({
      modelRoute: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://model.test', source: 'model' },
      catalogRoute: {
        protocol: 'OpenAICompatibleChatCompletions',
        baseUrl: 'https://catalog.test',
        headers: { 'X-GitHub-Api-Version': '2022-11-28' },
      },
    }).headers).toEqual({ 'X-GitHub-Api-Version': '2022-11-28' });
  });

  it('keys overlays by model and protocol', () => {
    const overlays = projectModelProtocolOverlays([
      { modelId: 'dual-model', protocol: 'AnthropicMessages', patch: { fixedTemperature: 1 }, factSourceId: 'test' },
      { modelId: 'dual-model', protocol: 'OpenAICompatibleChatCompletions', patch: { fixedTemperature: 0 }, factSourceId: 'test' },
    ], 'AnthropicMessages', new Map([['dual-model', 'AnthropicMessages']]), '2026-07-13T00:00:00.000Z');
    expect(overlays?.models).toEqual([{ modelId: 'dual-model', fixedTemperature: 1 }]);
  });
});
