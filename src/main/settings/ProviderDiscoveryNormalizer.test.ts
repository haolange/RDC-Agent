import { describe, expect, it } from 'vitest';
import { normalizeCopilotDiscoveryModels, normalizeProviderDiscoveryLayer } from './ProviderDiscoveryNormalizer';

describe('ProviderDiscoveryNormalizer', () => {
  it('collapses Copilot fast variants into the base model capability', () => {
    const models = normalizeCopilotDiscoveryModels([
      { modelId: 'gpt-5.4', availability: 'available' },
      { modelId: 'claude-opus-4.8', availability: 'available' },
      { modelId: 'claude-opus-4.8-fast', availability: 'available' },
      {
        modelId: 'claude-opus-4-8',
        availability: 'unavailable',
        unavailableReason: 'This model was not returned by the latest successful provider discovery.',
      },
    ]);

    expect(models.map((model) => model.modelId)).toEqual(['gpt-5.4', 'claude-opus-4.8']);
    expect(models[0].fast).toEqual({ kind: 'unsupported' });
    expect(models[1].fast).toEqual({
      kind: 'model-variant', modelId: 'claude-opus-4.8-fast', entitlement: 'granted',
    });
  });

  it('leaves every non-Copilot discovery layer unchanged', () => {
    const layer = {
      source: 'discovery' as const,
      observedAt: '2026-07-13T00:00:00.000Z',
      models: [{ modelId: 'provider-fast', availability: 'available' as const }],
    };
    expect(normalizeProviderDiscoveryLayer('custom-provider', layer)).toBe(layer);
  });
});
