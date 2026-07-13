import { describe, expect, it } from 'vitest';
import type { EffectiveModel } from '@shared/types/providerCapability';
import type { LlmProviderEntry } from '@shared/types/settings';
import { resolveAgentRouteCapability } from './RouteCapabilityResolver';

const provider = {
  id: 'test-provider',
  enabled: true,
  isConfigured: true,
  status: 'verified',
  protocol: 'OpenAICompatibleChatCompletions',
  capabilities: ['chat', 'tool-calling', 'vision-input', 'structured-output'],
} as LlmProviderEntry;

function model(patch: Partial<EffectiveModel> = {}): EffectiveModel {
  return {
    providerId: provider.id,
    modelId: 'model-a',
    label: 'Model A',
    aliases: [],
    route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'https://example.test', source: 'preset' },
    availability: 'available',
    contextTiers: [{ id: 'default', label: 'Default', activation: { kind: 'implicit' }, entitlement: 'granted' }],
    defaultBudgetTokens: 256_000,
    fast: { kind: 'unsupported' },
    reasoning: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
    toolCalling: { state: 'unknown' },
    visionInput: { state: 'unknown' },
    structuredOutput: { state: 'unknown' },
    provenance: [],
    ...patch,
  };
}

describe('resolveAgentRouteCapability effective-state policy', () => {
  it('fails open for unknown tools but marks the route unverified', () => {
    expect(resolveAgentRouteCapability(provider, 'model-a', model())).toMatchObject({
      toolCallingMode: 'native-structured',
      toolCallingUnverified: true,
    });
  });

  it('fails closed for unknown vision and uses prompt fallback for unknown structured output', () => {
    expect(resolveAgentRouteCapability(provider, 'model-a', model())).toMatchObject({
      visionInputMode: 'disabled',
      structuredOutputMode: 'prompt-fallback',
    });
  });

  it('honors explicit supported and unsupported states', () => {
    expect(resolveAgentRouteCapability(provider, 'model-a', model({
      toolCalling: { state: 'unsupported' },
      visionInput: { state: 'supported' },
      structuredOutput: { state: 'supported' },
    }))).toMatchObject({
      toolCallingMode: 'text-only',
      toolCallingUnverified: false,
      visionInputMode: 'native',
      structuredOutputMode: 'native',
    });
  });
});
