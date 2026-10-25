import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import {
  resolvedCapability,
  validateCapabilityResolution,
} from './capabilityResolution';

const effectiveModel = (overrides: Partial<EffectiveModel> = {}): EffectiveModel => ({
  providerId: 'provider-b',
  modelId: 'model-b',
  label: 'Model B',
  aliases: [],
  enabled: true,
  route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://example.test', source: 'catalog' },
  availability: 'available',
  presencePolicy: 'maintained',
  contextTiers: [],
  defaultBudgetTokens: 128_000,
  controls: {
    reasoning: {
      kind: 'none',
      supportsOff: true,
      levels: [],
      defaultSelection: 'off',
      wireProfile: { kind: 'none' },
    },
    fast: { state: 'unsupported', fixedValue: false },
    maxContext: { state: 'unsupported', fixedValue: false },
  },
  toolCalling: { state: 'supported' },
  visionInput: { state: 'unsupported' },
  structuredOutput: { state: 'supported' },
  provenance: [],
  catalogRevision: 'catalog-b',
  routeRevision: 'route-b',
  ...overrides,
});

describe('capability resolution state', () => {
  it('accepts only a revisioned model matching the committed Agent route', () => {
    const result = validateCapabilityResolution(
      { providerId: 'provider-b', modelId: 'model-b' },
      effectiveModel(),
    );
    expect(result.status).toBe('ready');
    expect(resolvedCapability(result)?.routeRevision).toBe('route-b');
  });

  it.each([
    [null, 'missing-model'],
    [effectiveModel({ catalogRevision: undefined }), 'missing-revision'],
    [effectiveModel({ providerId: 'provider-a', modelId: 'model-a' }), 'route-mismatch'],
  ] as const)('fails closed instead of returning a permanent loading sentinel', (model, reason) => {
    expect(validateCapabilityResolution(
      { providerId: 'provider-b', modelId: 'model-b' },
      model,
    )).toMatchObject({ status: 'unavailable', reason });
  });


});
