import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppSettings, LlmProviderEntry } from '@shared/types/settings';

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.TEMP ?? process.env.TMP ?? process.cwd(),
    getAppPath: () => process.cwd(),
  },
  safeStorage: {
    isEncryptionAvailable: () => false,
    decryptString: () => '',
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
  },
}));

import {
  applyDiscoveryAuthority,
  buildCatalogModelContribution,
  buildEffectiveCatalogRequest,
  planEffectiveModelRequest,
  refreshEffectiveCatalogDiscovery,
  resolveEffectiveModelSelection,
} from './EffectiveModelResolver';
import { mergeEffectiveCatalog } from './EffectiveCatalogService';
import { loadProviderSurface } from '../provider-catalog/ProviderCatalogRegistry';
import { planModelRequest } from './RequestPlanner';

function provider(id: string, protocol: LlmProviderEntry['protocol']): LlmProviderEntry {
  return {
    id,
    protocol,
    catalogOwnership: 'app-managed',
    models: [],
  } as unknown as LlmProviderEntry;
}

describe('EffectiveModelResolver compiled Catalog projection', () => {
  beforeAll(async () => {
    await Promise.all([
      loadProviderSurface('chatgpt-account'),
      loadProviderSurface('kimi-coding-plan'),
      loadProviderSurface('minimax-global'),
      loadProviderSurface('cortecs'),
      loadProviderSurface('custom-endpoint'),
    ]);
  });

  it('loads ChatGPT controls and execution binding from the manifest', () => {
    const contribution = buildCatalogModelContribution(
      provider('chatgpt-account', 'OpenAIResponses'),
      'gpt-5.5',
    );
    expect(contribution).toMatchObject({
      modelId: 'gpt-5.5',
      presencePolicy: 'account-entitled',
      controls: {
        fast: { state: 'selectable', defaultValue: false, entitlement: 'granted' },
        context1m: { state: 'unsupported', fixedValue: false },
        reasoning: { levels: ['low', 'medium', 'high', 'xhigh'], defaultSelection: 'medium' },
      },
      executionBindings: [{ id: 'fast:activation' }],
    });
  });

  it('projects account-scoped structure before entitlement refresh while planning stays fail-closed', () => {
    const chatgpt = provider('chatgpt-account', 'OpenAIResponses');
    const settings = { llm: { providers: [chatgpt], agentRoutes: [] } } as unknown as AppSettings;
    const selection = resolveEffectiveModelSelection('chatgpt-account', 'gpt-5.6-sol', settings);

    expect(selection.model).toMatchObject({
      modelId: 'gpt-5.6-sol',
      availability: 'unknown',
      controls: {
        fast: { state: 'selectable', defaultValue: false },
        context1m: { state: 'unsupported', fixedValue: false },
        reasoning: {
          levels: ['low', 'medium', 'high', 'xhigh', 'max'],
          defaultSelection: 'medium',
        },
      },
    });
    expect(planEffectiveModelRequest({
      providerId: 'chatgpt-account',
      modelId: 'gpt-5.6-sol',
      settings,
      controls: { fastModel: true },
    })).toMatchObject({
      ok: false,
      code: 'MODEL_UNAVAILABLE',
      message: expect.stringContaining('not yet verified'),
    });
  });

  it('projects model-level protocol overlays before live discovery', () => {
    const openAiKimi = mergeEffectiveCatalog(buildEffectiveCatalogRequest(
      provider('kimi-coding-plan', 'OpenAICompatibleChatCompletions'),
    )).find((model) => model.modelId === 'kimi-for-coding');
    expect(openAiKimi).toMatchObject({
      route: { protocol: 'OpenAICompatibleChatCompletions' },
      controls: { reasoning: { wireProfile: { kind: 'openai-compatible' } } },
      routeOptions: [
        { id: 'AnthropicMessages', route: { protocol: 'AnthropicMessages' } },
        { id: 'OpenAICompatibleChatCompletions', route: { protocol: 'OpenAICompatibleChatCompletions' } },
      ],
    });
    const anthropicKimi = mergeEffectiveCatalog(buildEffectiveCatalogRequest(
      provider('kimi-coding-plan', 'AnthropicMessages'),
    )).find((model) => model.modelId === 'kimi-for-coding');
    expect(anthropicKimi?.controls.reasoning.wireProfile).toMatchObject({ kind: 'anthropic' });
  });

  it('keeps all maintained Kimi models when candidate validation returns only the base', () => {
    const kimi = provider('kimi-coding-plan', 'AnthropicMessages');
    const discovery = applyDiscoveryAuthority(kimi, [{
      modelId: 'kimi-for-coding',
      availability: 'available',
    }]);
    expect(discovery).toEqual([{ modelId: 'kimi-for-coding', availability: 'available' }]);
    const request = buildEffectiveCatalogRequest(kimi);
    request.discovery = { source: 'discovery', observedAt: '2026-07-15T00:00:00.000Z', models: discovery };
    const models = mergeEffectiveCatalog(request);
    expect(models.filter((model) => model.selection?.pickerVisibility !== 'internal').map((model) => model.modelId))
      .toEqual(['kimi-for-coding', 'k2p7', 'k2p6', 'k2p5', 'kimi-k2-thinking']);
    expect(models.find((model) => model.modelId === 'kimi-for-coding-highspeed')).toMatchObject({
      selection: { pickerVisibility: 'internal' },
      availability: 'available',
    });
    const base = models.find((model) => model.modelId === 'kimi-for-coding');
    if (!base) throw new Error('Missing maintained Kimi base model');
    expect(planModelRequest({
      model: base,
      catalogModels: models,
      controls: { fastModel: true, reasoningLevel: 'on', maxContextMode: false },
    })).toMatchObject({
      ok: true,
      plan: {
        selectedModelId: 'kimi-for-coding',
        effectiveModelId: 'kimi-for-coding-highspeed',
        appliedBindingIds: ['fast:kimi-for-coding-highspeed'],
      },
    });
  });

  it('keeps the maintained MiniMax highspeed target when discovery validates only the base', () => {
    const minimax = provider('minimax-global', 'AnthropicMessages');
    const discovery = applyDiscoveryAuthority(minimax, [{
      modelId: 'MiniMax-M2.7',
      availability: 'available',
    }]);
    const request = buildEffectiveCatalogRequest(minimax);
    request.discovery = { source: 'discovery', observedAt: '2026-07-15T00:00:00.000Z', models: discovery };
    const models = mergeEffectiveCatalog(request);
    const base = models.find((model) => model.modelId === 'MiniMax-M2.7');
    expect(base).toBeDefined();
    expect(models.find((model) => model.modelId === 'MiniMax-M2.7-highspeed')).toMatchObject({
      availability: 'available',
      selection: { pickerVisibility: 'internal' },
    });
    expect(planModelRequest({
      model: base!,
      catalogModels: models,
      controls: { fastModel: true, reasoningLevel: 'on', maxContextMode: false },
    })).toMatchObject({
      ok: true,
      plan: {
        selectedModelId: 'MiniMax-M2.7',
        effectiveModelId: 'MiniMax-M2.7-highspeed',
        appliedBindingIds: ['fast:MiniMax-M2.7-highspeed'],
      },
    });
  });

  it('tombstones only account-entitled models absent from an authoritative list', () => {
    const chatgpt = provider('chatgpt-account', 'OpenAIResponses');
    const completed = applyDiscoveryAuthority(chatgpt, [{
      modelId: 'gpt-5.4', aliases: ['gpt-5.4-current'], availability: 'available',
    }]);
    expect(completed).toContainEqual(expect.objectContaining({ modelId: 'gpt-5.4', availability: 'available' }));
    expect(completed).toContainEqual({
      modelId: 'gpt-5.5',
      availability: 'unavailable',
      unavailableReason: 'This account-scoped model was absent from the authoritative provider catalog.',
    });
  });

  it('keeps user-managed definitions in the user layer', () => {
    const configured = {
      ...provider('custom-provider', 'OpenAICompatibleChatCompletions'),
      catalogOwnership: 'user-managed' as const,
      baseUrl: 'https://custom.example/v1',
      models: [{ id: 'custom-model', label: 'Custom model', enabled: true }],
    };
    const request = buildEffectiveCatalogRequest(configured);
    expect(request.catalog.models).toEqual([]);
    expect(request.user?.models).toEqual([
      expect.objectContaining({ modelId: 'custom-model', label: 'Custom model', availability: 'available' }),
    ]);
  });

  it('projects custom endpoint protocol options per model instead of a provider-global toggle', () => {
    const configured = {
      ...provider('custom-endpoint', 'OpenAICompatibleChatCompletions'),
      catalogOwnership: 'user-managed' as const,
      baseUrl: 'http://localhost:4312/v1',
      models: [{ id: 'custom-model', label: 'Custom model', enabled: true }],
    };
    const request = buildEffectiveCatalogRequest(configured);
    expect(request.user?.models[0]?.routeOptions).toMatchObject([
      { id: 'OpenAICompatibleChatCompletions', route: { protocol: 'OpenAICompatibleChatCompletions', baseUrl: 'http://localhost:4312/v1' } },
      { id: 'OpenAIResponses', route: { protocol: 'OpenAIResponses', baseUrl: 'http://localhost:4312/v1' } },
    ]);
  });

  it('projects a surface-level service tier onto every discovered model without changing model identity', async () => {
    const cortecs = {
      ...provider('cortecs', 'OpenAICompatibleChatCompletions'),
      catalogOwnership: 'provider-managed' as const,
      baseUrl: 'https://api.cortecs.ai/v1',
    };
    const snapshot = await refreshEffectiveCatalogDiscovery(cortecs, [{ id: 'live-model', label: 'Live model', enabled: true }], [{
      modelId: 'live-model',
      label: 'Live model',
      availability: 'available',
      contextTiers: [{
        id: 'default',
        label: 'Default',
        maxTotalTokens: 128_000,
        maxOutputTokens: 8_000,
        activation: { kind: 'implicit' },
        entitlement: 'granted',
      }],
      defaultBudgetTokens: 120_000,
    }]);
    const model = snapshot.models.find((entry) => entry.modelId === 'live-model');
    expect(model).toMatchObject({
      controls: { fast: { state: 'selectable', defaultValue: false } },
      executionBindings: [{ id: 'fast:cortecs-speed' }],
    });
    expect(planModelRequest({
      model: model!,
      catalogModels: snapshot.models,
      controls: { fastModel: true, reasoningLevel: 'off', maxContextMode: false },
    })).toMatchObject({
      ok: true,
      plan: {
        selectedModelId: 'live-model',
        effectiveModelId: 'live-model',
        appliedBindingIds: ['fast:cortecs-speed'],
        bodyPatch: { preference: 'speed' },
      },
    });
  });

  it('keeps an unverified model window unknown instead of inventing a 256K budget', () => {
    const contribution = buildCatalogModelContribution(
      provider('unknown-provider', 'OpenAICompatibleChatCompletions'),
      'unknown-model',
    );
    expect(contribution).toMatchObject({
      availability: 'unknown',
      defaultBudgetTokens: 0,
      contextTiers: [{ id: 'default', entitlement: 'unknown' }],
      controls: {
        fast: { state: 'unknown', defaultValue: false },
        context1m: { state: 'unknown', defaultValue: false },
      },
    });
    expect(contribution.contextTiers?.[0]).not.toHaveProperty('maxPromptTokens');
    expect(contribution.contextTiers?.[0]).not.toHaveProperty('maxTotalTokens');
  });

  it('auto-follows only proven aliases and records selected/effective ids', async () => {
    const customProvider = {
      ...provider('custom-provider-alias-test', 'OpenAICompatibleChatCompletions'),
      catalogOwnership: 'user-managed' as const,
      models: [
        { id: 'model-current', label: 'Current', aliases: ['model-old'], enabled: true, availability: 'available' as const },
        { id: 'model-next', label: 'Next', enabled: true, availability: 'available' as const },
      ],
    };
    const settings = { llm: { providers: [customProvider], agentRoutes: [] } } as unknown as AppSettings;
    await refreshEffectiveCatalogDiscovery(customProvider, customProvider.models, [
      {
        modelId: 'model-current', label: 'Current', aliases: ['model-old'], availability: 'available',
        contextTiers: [{ id: 'default', label: 'Default', maxPromptTokens: 128_000, activation: { kind: 'implicit' }, entitlement: 'granted' }],
        defaultBudgetTokens: 128_000,
      },
      {
        modelId: 'model-next', label: 'Next', availability: 'available',
        contextTiers: [{ id: 'default', label: 'Default', maxPromptTokens: 128_000, activation: { kind: 'implicit' }, entitlement: 'granted' }],
        defaultBudgetTokens: 128_000,
      },
    ]);
    expect(resolveEffectiveModelSelection('custom-provider-alias-test', 'model-old', settings)).toMatchObject({
      remappedFrom: 'model-old', model: { modelId: 'model-current' },
    });
    expect(planEffectiveModelRequest({
      providerId: 'custom-provider-alias-test', modelId: 'model-old', settings,
    })).toMatchObject({
      ok: true,
      plan: { selectedModelId: 'model-current', effectiveModelId: 'model-current' },
    });
  });
});
