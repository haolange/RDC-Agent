import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { agentManifestService } from './AgentManifestService';
import type { AgentManifestSettings } from '@shared/types/agentManifest';
import type { EffectiveCatalogSnapshot } from '@shared/types/providerCapability';
import type { LlmProviderEntry } from '@shared/types/settings';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('AgentManifestService seed manifests', () => {
  it('writes seeds with task token and without todo', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-agent-seeds-'));
    roots.push(root);
    const agentsPath = path.join(root, 'agents');
    const instructionsPath = path.join(root, 'RDX.md');

    const settings = agentManifestService.getSettings(
      { agentsPath, instructionsPath },
      [],
      [],
    );

    expect(settings.definitions.length).toBeGreaterThan(0);
    for (const definition of settings.definitions) {
      expect(definition.tools).not.toContain('todo');
      expect(definition.tools).not.toContain('search_codebase');
      // 所有 seed 都保留 tool_search 发现入口。
      expect(definition.tools).toContain('tool_search');
    }
    // Tier 收窄：ask 是纯问答面（无 task），plan/edit 保留 task。
    const byId = new Map(settings.definitions.map((definition) => [definition.id, definition]));
    expect(byId.get('ask')?.tools).not.toContain('task');
    expect(byId.get('plan')?.tools).toContain('task');
    expect(byId.get('edit')?.tools).toContain('task');
    expect(byId.get('edit')?.tools).toContain('file-manage');
    expect(byId.get('edit')?.tools).toContain('memory-write');
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
    const definitions = [{
      id: 'edit', models: ['github-copilot/claude-sonnet-5'],
    }] as AgentManifestSettings['definitions'];
    const settings = {
      directoryPath: '', definitions, modelOptions: [], globalInstructions: '',
    } satisfies AgentManifestSettings;
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
      generatedAt: '2026-07-14T00:00:00.000Z', stale: false, refreshing: false,
      models: [
        { ...baseModel, modelId: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', availability: 'available' as const },
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

    const projected = agentManifestService.projectEffectiveModelOptions(
      settings,
      [provider],
      [{ agentId: 'edit', providerId: 'github-copilot', modelId: 'claude-sonnet-5' }],
      [catalog],
    );
    expect(projected.modelOptions).toEqual([
      expect.objectContaining({ modelId: 'gemini-3.1-pro-preview', configured: true, status: 'ready' }),
      expect.objectContaining({ modelId: 'claude-sonnet-5', configured: false, status: 'model-unavailable', disabledReason: 'Not returned by this account.' }),
    ]);
    expect(projected.modelOptions.some((option) => option.modelId === 'persisted-only')).toBe(false);
    expect(projected.modelOptions.some((option) => option.modelId === 'unknown-tools')).toBe(false);
    expect(projected.modelOptions.some((option) => option.modelId === 'unverified-model')).toBe(false);
    expect(projected.modelOptions.some((option) => option.modelId === 'zero-budget-model')).toBe(false);
    expect(projected.modelOptions.some((option) => option.modelId === 'claude-opus-4.8-fast')).toBe(false);
  });

  it('retains a referenced zero-budget primary model only as a disabled diagnostic', () => {
    const provider = {
      id: 'github-copilot', label: 'GitHub Copilot', protocol: 'OpenAICompatibleChatCompletions',
      catalogOwnership: 'app-managed', activeAccountId: 'account-a', enabled: true, isConfigured: true, models: [],
    } as unknown as LlmProviderEntry;
    const settings = {
      directoryPath: '',
      definitions: [{ id: 'edit', models: ['github-copilot/unverified-budget'] }],
      modelOptions: [], globalInstructions: '',
    } as unknown as AgentManifestSettings;
    const catalog = {
      providerId: 'github-copilot', accountId: 'account-a', protocol: 'OpenAICompatibleChatCompletions',
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

    const projected = agentManifestService.projectEffectiveModelOptions(
      settings,
      [provider],
      [{ agentId: 'edit', providerId: 'github-copilot', modelId: 'unverified-budget' }],
      [catalog],
    );

    expect(projected.modelOptions).toEqual([expect.objectContaining({
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
    const settings = {
      directoryPath: '',
      definitions: [{ id: 'edit', models: ['kimi-coding-plan/kimi-for-coding-highspeed'] }],
      modelOptions: [],
      globalInstructions: '',
    } as unknown as AgentManifestSettings;
    const catalog = {
      providerId: 'kimi-coding-plan',
      accountId: 'account-a',
      protocol: 'OpenAICompatibleChatCompletions',
      catalogRevision: 'test-catalog',
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

    const projected = agentManifestService.projectEffectiveModelOptions(
      settings,
      [provider],
      [{ agentId: 'edit', providerId: 'kimi-coding-plan', modelId: 'kimi-for-coding-highspeed' }],
      [catalog],
    );

    expect(projected.modelOptions).toEqual([]);
  });

  it('loads catalogs for configured app-managed providers and referenced diagnostics only', () => {
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

    expect(agentManifestService.modelOptionCatalogProviderIds(
      [copilot, referencedDisconnected, unusedDisconnected, userManaged],
      routes,
    )).toEqual(['referenced-provider', 'github-copilot']);

    expect(agentManifestService.modelOptionCatalogProviderIds(
      [{ ...copilot, isConfigured: false }, unusedDisconnected],
      [],
    )).toEqual([]);
  });
});
