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
      expect(definition.tools).toContain('task');
      expect(definition.tools).not.toContain('todo');
      expect(definition.tools).not.toContain('search_codebase');
    }
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
        context1m: { state: 'unsupported' as const, fixedValue: false },
        reasoning: { kind: 'unknown' as const, supportsOff: false, levels: [], defaultSelection: 'off' as const, wireProfile: { kind: 'none' as const } },
      },
      toolCalling: { state: 'unknown' as const }, visionInput: { state: 'unknown' as const }, structuredOutput: { state: 'unknown' as const },
      provenance: [],
    };
    const catalog = {
      providerId: 'github-copilot', accountId: 'account-a', protocol: 'OpenAICompatibleChatCompletions', catalogRevision: 'test-catalog',
      generatedAt: '2026-07-14T00:00:00.000Z', stale: false, refreshing: false,
      models: [
        { ...baseModel, modelId: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', availability: 'available' as const },
        { ...baseModel, modelId: 'claude-sonnet-5', label: 'Claude Sonnet 5', availability: 'unavailable' as const, unavailableReason: 'Not returned by this account.' },
        { ...baseModel, modelId: 'unverified-model', label: 'Unverified', availability: 'unknown' as const },
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
    expect(projected.modelOptions.some((option) => option.modelId === 'unverified-model')).toBe(false);
  });
});
