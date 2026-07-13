import { describe, expect, it } from 'vitest';
import { projectProtocolOverlays, resolveModelRoutePrecedence } from './ProviderRouteProjection';

describe('provider route projection', () => {
  it('applies model route before user enum and preset default', () => {
    expect(resolveModelRoutePrecedence({
      modelRoute: { protocol: 'AnthropicMessages', baseUrl: 'https://model.test', source: 'preset' },
      userRoute: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://user.test' },
      presetRoute: { protocol: 'OpenAIResponses', baseUrl: 'https://preset.test' },
    })).toMatchObject({ protocol: 'AnthropicMessages', baseUrl: 'https://model.test', source: 'model' });
  });

  it('keys overlays by model and protocol', () => {
    const overlays = projectProtocolOverlays([
      { modelId: 'dual-model', protocol: 'AnthropicMessages', patch: { fixedTemperature: 1 } },
      { modelId: 'dual-model', protocol: 'OpenAICompatibleChatCompletions', patch: { fixedTemperature: 0 } },
    ], 'AnthropicMessages', '2026-07-13T00:00:00.000Z');
    expect(overlays?.models).toEqual([{ modelId: 'dual-model', fixedTemperature: 1 }]);
  });
});
