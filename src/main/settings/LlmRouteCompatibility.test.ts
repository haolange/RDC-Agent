import { describe, expect, it } from 'vitest';
import type { LlmProviderEntry } from '@shared/types/settings';
import { resolveProviderModelAvailability } from './LlmRouteCompatibility';

function provider(overrides: Partial<LlmProviderEntry> = {}): LlmProviderEntry {
  return {
    id: 'openai',
    protocol: 'OpenAIResponses',
    authMode: 'api-key',
    category: 'official-direct',
    catalogOwnership: 'app-managed',
    modelDiscovery: 'openai-compatible',
    label: 'OpenAI',
    enabled: true,
    apiKey: '',
    hasStoredSecret: true,
    models: [{ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', enabled: true }],
    recommendedModels: ['gpt-5.6-sol'],
    status: 'verified',
    isConfigured: true,
    ...overrides,
  };
}

describe('model removal semantics', () => {
  it('auto-follows a proven canonical alias', () => {
    expect(resolveProviderModelAvailability(provider(), 'gpt-5.6')).toMatchObject({
      modelId: 'gpt-5.6-sol',
      requestedModelId: 'gpt-5.6',
      remapReason: expect.stringContaining('catalog alias'),
    });
  });

  it('returns recommendations but never silently substitutes a missing model', () => {
    expect(resolveProviderModelAvailability(provider(), 'removed-model')).toEqual({
      modelId: null,
      requestedModelId: 'removed-model',
      unavailable: {
        code: 'MODEL_UNAVAILABLE',
        providerId: 'openai',
        modelId: 'removed-model',
        recommendedModelIds: ['gpt-5.6-sol'],
        message: expect.stringContaining('Available alternatives: gpt-5.6-sol'),
      },
    });
  });

  it('does not silently downgrade unsupported Copilot request routes', () => {
    const resolution = resolveProviderModelAvailability(provider({
      id: 'github-copilot',
      protocol: 'OpenAICompatibleChatCompletions',
      models: [
        { id: 'gpt-5.6', label: 'GPT-5.6', enabled: true },
        { id: 'gpt-4.1', label: 'GPT-4.1', enabled: true },
      ],
      recommendedModels: ['gpt-4.1'],
    }), 'gpt-5.6');
    expect(resolution.modelId).toBeNull();
    expect(resolution.unavailable?.recommendedModelIds).toEqual(['gpt-4.1']);
  });
});
