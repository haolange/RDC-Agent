import { describe, expect, it } from 'vitest';
import { buildAgentModelOptions, modelOptionCatalogProviderIds } from './agentModelOptions';
import type { EffectiveCatalogSnapshot } from '../types/providerCapability';
import type { AgentModelSettings, LlmProviderEntry } from '../types/settings';

const NO_MODELS: AgentModelSettings = { default: {}, byAgent: {} };

describe('Agent model options from effective catalogs', () => {
  it('projects provider connection state without confusing derived enabled=false with user disablement', () => {
    const base = {
      id: 'provider', label: 'Provider', catalogOwnership: 'user-managed',
      enabled: false, isConfigured: false, models: [{ id: 'model', enabled: true }],
    } as unknown as LlmProviderEntry;
    const project = (provider: LlmProviderEntry) => buildAgentModelOptions({
      providers: [provider], routes: [{ agentId: 'general', providerId: 'provider', modelId: 'model' }], agentModels: NO_MODELS, catalogs: [],
    })[0];

    expect(project({ ...base, status: 'unconfigured' })).toMatchObject({
      status: 'provider-unavailable', providerIssue: 'unconfigured',
    });
    expect(project({ ...base, status: 'unconfigured' })).not.toHaveProperty('disabledReason');
    expect(project({ ...base, status: 'failed', lastError: 'HTTP 401: account denied' })).toMatchObject({
      providerIssue: 'failed', disabledReason: 'HTTP 401: account denied',
    });
    expect(project({ ...base, status: 'unavailable', unavailableReason: 'Account route is restricted' })).toMatchObject({
      providerIssue: 'unavailable', disabledReason: 'Account route is restricted',
    });
    expect(project({ ...base, status: 'unconfigured', models: [] })).toMatchObject({
      status: 'provider-unavailable', providerIssue: 'unconfigured',
    });
  });

  it('projects app-managed choices from EffectiveCatalog and retains only referenced tombstones', () => {
    const provider = {
      id: 'github-copilot',
      label: 'GitHub Copilot',
      protocol: 'OpenAICompatibleChatCompletions',
      catalogOwnership: 'app-managed',
      activeAccountId: 'account-a',
      enabled: true,
      isConfigured: true,
      models: [
        { id: 'claude-sonnet-5', label: 'Persisted Claude', enabled: true },
        { id: 'persisted-only', label: 'Persisted only', enabled: true },
      ],
    } as LlmProviderEntry;
    const baseModel = {
      providerId: 'github-copilot', aliases: [], enabled: true,
      route: { protocol: 'OpenAICompatibleChatCompletions' as const, source: 'catalog' as const },
      presencePolicy: 'account-entitled' as const,
      contextTiers: [{ id: 'default', label: 'Default', maxTotalTokens: 200_000, activation: { kind: 'implicit' as const }, entitlement: 'granted' as const }],
      defaultBudgetTokens: 200_000,
      controls: {
        fast: { state: 'unsupported' as const, fixedValue: false },
        maxContext: { state: 'unsupported' as const, fixedValue: false },
        reasoning: { kind: 'unknown' as const, supportsOff: false, levels: [], defaultSelection: 'off' as const, wireProfile: { kind: 'none' as const } },
      },
      selection: { pickerVisibility: 'primary' as const },
      toolCalling: { state: 'supported' as const }, visionInput: { state: 'unknown' as const }, structuredOutput: { state: 'unknown' as const },
      provenance: [],
    };
    const catalog = {
      providerId: 'github-copilot', accountId: 'account-a', protocol: 'OpenAICompatibleChatCompletions', catalogRevision: 'test-catalog',
      scopeGeneration: 'fixture', projectionVersion: 1,
      generatedAt: '2026-07-14T00:00:00.000Z', stale: false, refreshing: false,
      models: [
        { ...baseModel, modelId: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', availability: 'available' as const,
          controls: { ...baseModel.controls, reasoning: { kind: 'levels' as const, supportsOff: false, levels: ['low' as const, 'high' as const],
            defaultSelection: 'high' as const, wireProfile: { kind: 'none' as const } } } },
        { ...baseModel, modelId: 'unknown-tools', label: 'Unknown tools', availability: 'available' as const, toolCalling: { state: 'unknown' as const } },
        {
          ...baseModel,
          modelId: 'claude-opus-4.8-fast',
          label: 'Claude Opus 4.8 Fast',
          availability: 'available' as const,
          selection: { pickerVisibility: 'internal' as const, relatedPrimaryModelIds: ['claude-opus-4.8'] },
        },
        { ...baseModel, modelId: 'claude-sonnet-5', label: 'Claude Sonnet 5', availability: 'unavailable' as const, unavailableReason: 'Not returned by this account.' },
        { ...baseModel, modelId: 'unverified-model', label: 'Unverified', availability: 'unknown' as const },
        { ...baseModel, modelId: 'zero-budget-model', label: 'Zero budget', availability: 'available' as const, defaultBudgetTokens: 0 },
      ],
    } satisfies EffectiveCatalogSnapshot;

    const options = buildAgentModelOptions({ providers: [provider], routes: [{ agentId: 'edit', providerId: 'github-copilot', modelId: 'claude-sonnet-5' }], agentModels: NO_MODELS, catalogs: [catalog] });
    expect(options).toEqual([
      expect.objectContaining({ modelId: 'gemini-3.1-pro-preview', configured: true, status: 'ready', reasoningSelections: ['low', 'high'] }),
      expect.objectContaining({ modelId: 'claude-sonnet-5', configured: false, status: 'model-unavailable', disabledReason: 'Not returned by this account.', reasoningSelections: null }),
    ]);
    expect(options.some((option) => option.modelId === 'persisted-only')).toBe(false);
    expect(options.some((option) => option.modelId === 'unknown-tools')).toBe(false);
    expect(options.some((option) => option.modelId === 'unverified-model')).toBe(false);
    expect(options.some((option) => option.modelId === 'zero-budget-model')).toBe(false);
    expect(options.some((option) => option.modelId === 'claude-opus-4.8-fast')).toBe(false);
  });

  it('retains a referenced zero-budget primary model only as a disabled diagnostic', () => {
    const provider = {
      id: 'github-copilot', label: 'GitHub Copilot', protocol: 'OpenAICompatibleChatCompletions',
      catalogOwnership: 'app-managed', activeAccountId: 'account-a', enabled: true, isConfigured: true, models: [],
    } as unknown as LlmProviderEntry;
    const catalog = {
      providerId: 'github-copilot', accountId: 'account-a', protocol: 'OpenAICompatibleChatCompletions',
      scopeGeneration: 'fixture', projectionVersion: 1,
      catalogRevision: 'test-catalog', generatedAt: '2026-07-17T00:00:00.000Z', stale: false, refreshing: false,
      models: [{
        providerId: 'github-copilot', modelId: 'unverified-budget', label: 'Unverified budget', aliases: [], enabled: true,
        route: { protocol: 'OpenAICompatibleChatCompletions', source: 'catalog' }, presencePolicy: 'account-entitled',
        availability: 'available', contextTiers: [], defaultBudgetTokens: 0,
        controls: {
          fast: { state: 'unsupported', fixedValue: false }, maxContext: { state: 'unsupported', fixedValue: false },
          reasoning: { kind: 'unknown', supportsOff: false, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
        },
        selection: { pickerVisibility: 'primary' }, toolCalling: { state: 'unknown' }, visionInput: { state: 'unknown' },
        structuredOutput: { state: 'unknown' }, provenance: [],
      }],
    } satisfies EffectiveCatalogSnapshot;

    const options = buildAgentModelOptions({ providers: [provider], routes: [{ agentId: 'edit', providerId: 'github-copilot', modelId: 'unverified-budget' }], agentModels: NO_MODELS, catalogs: [catalog] });

    expect(options).toEqual([expect.objectContaining({
      modelId: 'unverified-budget', configured: false, status: 'model-unverified',
      disabledReason: 'Model has no verified positive context budget and cannot be executed safely.',
    })]);
  });

  it('does not synthesize a selector tombstone for a referenced internal target', () => {
    const provider = {
      id: 'kimi-coding-plan',
      label: 'Kimi Coding Plan',
      protocol: 'OpenAICompatibleChatCompletions',
      catalogOwnership: 'app-managed',
      activeAccountId: 'account-a',
      enabled: true,
      isConfigured: true,
      models: [],
    } as unknown as LlmProviderEntry;
    const catalog = {
      providerId: 'kimi-coding-plan',
      accountId: 'account-a',
      protocol: 'OpenAICompatibleChatCompletions',
      catalogRevision: 'test-catalog',
      scopeGeneration: 'fixture', projectionVersion: 1,
      generatedAt: '2026-07-17T00:00:00.000Z',
      stale: false,
      refreshing: false,
      models: [{
        providerId: 'kimi-coding-plan',
        modelId: 'kimi-for-coding-highspeed',
        label: 'Kimi for Coding Highspeed',
        aliases: [],
        enabled: true,
        route: { protocol: 'OpenAICompatibleChatCompletions', source: 'catalog' },
        presencePolicy: 'maintained',
        availability: 'available',
        contextTiers: [{ id: 'default', label: 'Default', maxTotalTokens: 128_000, activation: { kind: 'implicit' }, entitlement: 'granted' }],
        defaultBudgetTokens: 128_000,
        controls: {
          fast: { state: 'unsupported', fixedValue: false },
          maxContext: { state: 'unsupported', fixedValue: false },
          reasoning: { kind: 'unknown', supportsOff: false, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
        },
        selection: { pickerVisibility: 'internal', relatedPrimaryModelIds: ['kimi-for-coding'] },
        toolCalling: { state: 'unknown' },
        visionInput: { state: 'unknown' },
        structuredOutput: { state: 'unknown' },
        provenance: [],
      }],
    } satisfies EffectiveCatalogSnapshot;

    const options = buildAgentModelOptions({ providers: [provider], routes: [{ agentId: 'edit', providerId: 'kimi-coding-plan', modelId: 'kimi-for-coding-highspeed' }], agentModels: NO_MODELS, catalogs: [catalog] });

    expect(options).toEqual([]);
  });

  it('loads catalogs for all configured providers and referenced diagnostics only', () => {
    const provider = (id: string, overrides: Partial<LlmProviderEntry> = {}): LlmProviderEntry => ({
      id,
      label: id,
      protocol: 'OpenAICompatibleChatCompletions',
      catalogOwnership: 'app-managed',
      enabled: true,
      isConfigured: false,
      models: [],
      ...overrides,
    } as unknown as LlmProviderEntry);
    const copilot = provider('github-copilot', { isConfigured: true });
    const referencedDisconnected = provider('referenced-provider');
    const unusedDisconnected = provider('unused-provider');
    const userManaged = provider('custom-provider', {
      catalogOwnership: 'user-managed',
      isConfigured: true,
    });
    const routes = [{
      agentId: 'edit',
      providerId: 'referenced-provider',
      modelId: 'missing-model',
    }];

    expect([...modelOptionCatalogProviderIds(
      [copilot, referencedDisconnected, unusedDisconnected, userManaged],
      routes,
    )]).toEqual(['referenced-provider', 'github-copilot', 'custom-provider']);

    expect([...modelOptionCatalogProviderIds(
      [{ ...copilot, isConfigured: false }, unusedDisconnected],
      [],
    )]).toEqual([]);
  });

  it('selects a user-managed model only from its current account and protocol catalog', () => {
    const provider = { id: 'local', label: 'Local', protocol: 'OpenAICompatibleChatCompletions',
      catalogOwnership: 'user-managed', enabled: true, isConfigured: true,
      models: [{ id: 'model', label: 'Model', enabled: true }] } as unknown as LlmProviderEntry;
    const catalog = { providerId: 'local', accountId: 'anonymous:local', protocol: 'OpenAICompatibleChatCompletions',
      catalogRevision: 'revision', scopeGeneration: 'generation', projectionVersion: 1,
      generatedAt: '2026-11-13T00:00:00Z', stale: false, refreshing: false,
      models: [{ providerId: 'local', modelId: 'model', label: 'Model', aliases: [], enabled: true,
        availability: 'available', presencePolicy: 'discovered', defaultBudgetTokens: 128_000,
        route: { protocol: 'OpenAICompatibleChatCompletions', source: 'catalog' }, contextTiers: [],
        controls: { fast: { state: 'unknown', defaultValue: false }, maxContext: { state: 'unsupported', fixedValue: false },
          reasoning: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } } },
        toolCalling: { state: 'supported' }, visionInput: { state: 'unknown' }, structuredOutput: { state: 'unknown' }, provenance: [],
      }] } satisfies EffectiveCatalogSnapshot;
    expect(buildAgentModelOptions({ providers: [provider], routes: [], agentModels: NO_MODELS, catalogs: [catalog] }))
      .toEqual([expect.objectContaining({ modelId: 'model', status: 'ready' })]);
    expect(buildAgentModelOptions({ providers: [provider], routes: [], agentModels: NO_MODELS, catalogs: [{ ...catalog, protocol: 'OpenAIResponses' }] }))
      .toEqual([]);
  });
});
