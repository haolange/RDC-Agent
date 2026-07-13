import { describe, expect, it, vi } from 'vitest';
import type { LlmProviderEntry } from '@shared/types/settings';
import type { AppSettings } from '@shared/types/settings';

vi.mock('electron', () => ({
  app: { getPath: () => process.cwd(), getAppPath: () => process.cwd() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    decryptString: () => '',
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
  },
}));

import {
  buildEffectiveCatalogRequest,
  buildSeedModelContribution,
  completeDiscoveryContributions,
  planEffectiveModelRequest,
  resolveEffectiveModelSelection,
} from './EffectiveModelResolver';
import { mergeEffectiveCatalog } from './EffectiveCatalogService';

function provider(id: string, protocol: LlmProviderEntry['protocol']): LlmProviderEntry {
  return {
    id,
    protocol,
    catalogOwnership: 'app-managed',
    models: [],
  } as unknown as LlmProviderEntry;
}

describe('surface-specific effective model seeds', () => {
  it('keeps ChatGPT on the Codex surface with dynamic context and request-param Fast', () => {
    const model = buildSeedModelContribution(provider('chatgpt-account', 'OpenAIResponses'), 'gpt-5.5');
    expect(model.contextTiers).toEqual([
      { id: 'default', label: 'Codex service limit', activation: { kind: 'implicit' }, entitlement: 'granted' },
    ]);
    expect(model.fast).toEqual({ kind: 'request-param', patch: { service_tier: 'priority' }, entitlement: 'granted', label: 'Fast' });
  });

  it('uses a header-activated unknown 1M tier for Claude Account', () => {
    const model = buildSeedModelContribution(provider('claude-account', 'AnthropicMessages'), 'claude-sonnet-5');
    expect(model.contextTiers?.[1]).toEqual({
      id: 'max', label: '1M context', maxPromptTokens: 1_000_000,
      activation: { kind: 'header', headers: { 'anthropic-beta': 'context-1m-2025-08-07' } },
      entitlement: 'unknown',
    });
  });

  it('uses an implicit granted 1M tier for direct Anthropic modern models', () => {
    const model = buildSeedModelContribution(provider('anthropic', 'AnthropicMessages'), 'claude-sonnet-5');
    expect(model.contextTiers?.[1]).toMatchObject({
      id: 'max', maxPromptTokens: 1_000_000, activation: { kind: 'implicit' }, entitlement: 'granted',
    });
  });

  it('falls back to one conservative Copilot tier without account billing', () => {
    const model = buildSeedModelContribution(provider('github-copilot', 'OpenAICompatibleChatCompletions'), 'gpt-5.5');
    expect(model.contextTiers).toEqual([
      { id: 'default', label: 'Default', maxPromptTokens: 272_000, activation: { kind: 'implicit' }, entitlement: 'granted' },
    ]);
    expect(model.fast).toEqual({ kind: 'unsupported' });
    expect(buildSeedModelContribution(
      provider('github-copilot', 'OpenAICompatibleChatCompletions'),
      'claude-opus-4-8',
    ).fast).toEqual({ kind: 'model-variant', modelId: 'claude-opus-4-8-fast', entitlement: 'granted' });
  });

  it('keeps app-managed settings state out of the bundled seed layer', () => {
    const configured = provider('chatgpt-account', 'OpenAIResponses');
    configured.models = [{
      id: 'gpt-5.5',
      label: 'Persisted label',
      enabled: false,
      availability: 'unavailable',
      availabilityReason: 'User disabled the model',
    }];

    const model = buildSeedModelContribution(configured, 'gpt-5.5');
    expect(model.label).toBe('gpt-5.5');
    expect(model.availability).toBe('available');
    expect(model.unavailableReason).toBeUndefined();
  });

  it('projects user-managed model definitions only through the user layer', () => {
    const configured = {
      ...provider('custom-provider', 'OpenAICompatibleChatCompletions'),
      catalogOwnership: 'user-managed' as const,
      baseUrl: 'https://custom.example/v1',
      protocolEditable: true,
      lastModelRefreshAt: '2026-07-13T00:00:00.000Z',
      models: [{ id: 'custom-model', label: 'Custom model', enabled: true }],
    };

    const request = buildEffectiveCatalogRequest(configured);
    expect(request.seed.models).toEqual([]);
    expect(request.user?.models).toEqual([
      expect.objectContaining({ modelId: 'custom-model', label: 'Custom model', availability: 'available' }),
    ]);
  });

  it('keeps discovered capability leaves when user-managed labels and selection are projected', () => {
    const configured = {
      ...provider('custom-provider', 'OpenAICompatibleChatCompletions'),
      catalogOwnership: 'user-managed' as const,
      models: [{ id: 'custom-model', label: 'My custom label', enabled: true }],
    };
    const request = buildEffectiveCatalogRequest(configured);
    request.discovery = {
      source: 'discovery',
      observedAt: '2026-07-13T00:00:00.000Z',
      models: [{
        modelId: 'custom-model',
        contextTiers: [{
          id: 'default', label: 'Default', maxPromptTokens: 131_072,
          activation: { kind: 'implicit' }, entitlement: 'granted',
        }],
        toolCalling: { state: 'supported' },
      }],
    };

    expect(mergeEffectiveCatalog(request)[0]).toMatchObject({
      label: 'My custom label',
      contextTiers: [{ maxPromptTokens: 131_072 }],
      toolCalling: { state: 'supported' },
    });
  });

  it('applies selection state to authoritative app-managed models that are absent from the seed', () => {
    const configured = {
      ...provider('opencode-zen', 'OpenAICompatibleChatCompletions'),
      models: [{ id: 'minimax-m3', label: 'MiniMax M3', enabled: false }],
    };
    const request = buildEffectiveCatalogRequest(configured);
    request.discovery = {
      source: 'discovery',
      observedAt: '2026-07-13T00:00:00.000Z',
      models: [{ modelId: 'minimax-m3', availability: 'available' }],
    };

    expect(mergeEffectiveCatalog(request).find((model) => model.modelId === 'minimax-m3')).toMatchObject({
      availability: 'available',
      enabled: false,
    });
  });

  it('limits the app-managed user layer to D2 model preferences', () => {
    const configured = {
      ...provider('chatgpt-account', 'OpenAIResponses'),
      models: [{
        id: 'gpt-5.5',
        label: 'Stale local label',
        aliases: ['stale-alias'],
        enabled: false,
        availability: 'unavailable' as const,
        availabilityReason: 'Stale local availability',
        defaultReasoningSelection: 'high' as const,
        defaultBudgetTokens: 120_000,
      }],
    };
    const request = buildEffectiveCatalogRequest(configured);
    request.discovery = {
      source: 'discovery',
      observedAt: '2026-07-13T00:00:00.000Z',
      models: [{
        modelId: 'gpt-5.5',
        label: 'Live catalog label',
        aliases: ['live-alias'],
        availability: 'available',
      }],
    };

    expect(mergeEffectiveCatalog(request).find((model) => model.modelId === 'gpt-5.5')).toMatchObject({
      label: 'Live catalog label',
      aliases: ['live-alias'],
      availability: 'available',
      enabled: false,
      defaultBudgetTokens: 120_000,
      reasoning: { defaultSelection: 'high' },
    });
  });

  it('projects provider runtime unavailability into every EffectiveModel', () => {
    const configured = {
      ...provider('azure-openai', 'AzureOpenAIChatCompletions'),
      status: 'unavailable' as const,
      unavailableReason: 'Azure adapter is not implemented.',
    };
    const request = buildEffectiveCatalogRequest(configured);
    expect(request.providerAvailability).toMatchObject({
      state: 'unavailable',
      reason: 'Azure adapter is not implemented.',
    });
    expect(mergeEffectiveCatalog(request).find((model) => model.modelId === 'gpt-5.5')).toMatchObject({
      availability: 'unavailable',
      unavailableReason: 'Azure adapter is not implemented.',
    });
  });

  it('tombstones app-managed seed models missing from a successful live discovery', () => {
    const completed = completeDiscoveryContributions(
      provider('chatgpt-account', 'OpenAIResponses'),
      [{ modelId: 'gpt-5.4', aliases: ['gpt-5.4-current'], availability: 'available' }],
    );
    expect(completed).toContainEqual(expect.objectContaining({
      modelId: 'gpt-5.4',
      availability: 'available',
    }));
    expect(completed).toContainEqual({
      modelId: 'gpt-5.5',
      availability: 'unavailable',
      unavailableReason: 'This model was not returned by the latest successful provider discovery.',
    });
  });

  it('auto-follows only proven aliases and otherwise returns explicit same-provider recommendations', () => {
    const customProvider = {
      ...provider('custom-provider', 'OpenAICompatibleChatCompletions'),
      catalogOwnership: 'user-managed' as const,
      models: [
        { id: 'model-current', label: 'Current', aliases: ['model-old'], enabled: true, availability: 'available' as const },
        { id: 'model-next', label: 'Next', enabled: true, availability: 'available' as const },
      ],
    };
    const settings = { llm: { providers: [customProvider], agentRoutes: [] } } as unknown as AppSettings;

    expect(resolveEffectiveModelSelection('custom-provider', 'model-old', settings)).toMatchObject({
      requestedModelId: 'model-old',
      remappedFrom: 'model-old',
      model: { modelId: 'model-current' },
    });
    expect(planEffectiveModelRequest({
      providerId: 'custom-provider', modelId: 'model-old', settings,
    })).toMatchObject({
      ok: true,
      plan: { effectiveModelId: 'model-current' },
      warnings: [
        'Context tier Default is unverified',
        'Canonical model alias remap: model-old -> model-current.',
      ],
    });
    expect(resolveEffectiveModelSelection('custom-provider', 'missing-model', settings)).toMatchObject({
      model: null,
      recommendations: [
        { providerId: 'custom-provider', modelId: 'model-current', label: 'Current' },
        { providerId: 'custom-provider', modelId: 'model-next', label: 'Next' },
      ],
    });
  });
});
