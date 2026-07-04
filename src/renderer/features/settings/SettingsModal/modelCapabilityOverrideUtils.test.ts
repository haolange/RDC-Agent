import { describe, expect, it } from 'vitest';
import type { LlmProviderEntry, LlmProviderModel } from '@shared/types/settings';
import {
  applyDraftCapabilityOverrides,
  mergeModelCapabilityOverrides,
  normalizeCapabilityOverride,
} from './modelCapabilityOverrideUtils';

const baseProvider = (models: LlmProviderModel[]): LlmProviderEntry => ({
  id: 'openai',
  protocol: 'OpenAICompatibleChatCompletions',
  authMode: 'api-key',
  category: 'official-direct',
  modelDiscovery: 'openai-compatible',
  label: 'OpenAI',
  enabled: true,
  apiKey: '',
  hasStoredSecret: true,
  models,
  recommendedModels: [],
  status: 'verified',
  isConfigured: true,
});

describe('modelCapabilityOverrideUtils', () => {
  it('drops empty capability overrides', () => {
    expect(normalizeCapabilityOverride({})).toBeUndefined();
    expect(normalizeCapabilityOverride({
      supportedEffortLevels: [],
      fastVariantModelId: '  ',
    })).toBeUndefined();
  });

  it('keeps valid capability overrides', () => {
    expect(normalizeCapabilityOverride({
      nominalContextWindowTokens: 200_000,
      supportedEffortLevels: ['low', 'high'],
      fastVariantModelId: 'gpt-5-fast',
    })).toEqual({
      nominalContextWindowTokens: 200_000,
      supportedEffortLevels: ['low', 'high'],
      fastVariantModelId: 'gpt-5-fast',
    });
  });

  it('merges overrides across model rediscovery', () => {
    const previous: LlmProviderModel[] = [{
      id: 'gpt-5',
      label: 'GPT-5',
      enabled: true,
      capabilityOverride: { supportedEffortLevels: ['low', 'max'] },
    }];
    const next: LlmProviderModel[] = [{
      id: 'gpt-5',
      label: 'GPT-5',
      enabled: true,
    }];
    expect(mergeModelCapabilityOverrides(previous, next)).toEqual([{
      id: 'gpt-5',
      label: 'GPT-5',
      enabled: true,
      capabilityOverride: { supportedEffortLevels: ['low', 'max'] },
    }]);
  });

  it('removes capabilityOverride when draft clears overrides', () => {
    const provider = baseProvider([{
      id: 'claude-sonnet-4',
      label: 'Claude Sonnet 4',
      enabled: true,
      capabilityOverride: { fastVariantModelId: 'claude-sonnet-4-fast' },
    }]);
    const draft: LlmProviderModel[] = [{
      id: 'claude-sonnet-4',
      label: 'Claude Sonnet 4',
      enabled: true,
    }];
    const next = applyDraftCapabilityOverrides(provider, draft);
    expect(next.models[0].capabilityOverride).toBeUndefined();
    expect('capabilityOverride' in next.models[0]).toBe(false);
  });
});
