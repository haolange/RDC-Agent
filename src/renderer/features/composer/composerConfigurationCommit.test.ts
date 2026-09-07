import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildConversationConfigurationCommit } from '../../stores/conversationConfigurationCommit';

const flushAgentDefinitionSaves = vi.fn();
const flushProviderSaves = vi.fn();
const definitions: Array<{ id: string; provenance?: { scope: 'builtin' | 'user' | 'project'; sourcePath: string; sourceHash: string } }> = [];

vi.mock('../../stores/appSettingsStore', () => ({
  useAppSettingsStore: {
    getState: () => ({
      flushAgentDefinitionSaves,
      flushProviderSaves,
      settings: { agents: { definitions } },
    }),
  },
}));

describe('buildConversationConfigurationCommit', () => {
  beforeEach(() => {
    flushAgentDefinitionSaves.mockReset();
    flushProviderSaves.mockReset();
    definitions.splice(0);
  });

  it('flushes agent and provider and freezes the selected model revision', async () => {
    flushAgentDefinitionSaves.mockResolvedValue({
      commitHash: 'agent-hash',
      route: { providerId: 'openai', modelId: 'gpt-5.6-sol' },
    });
    flushProviderSaves.mockResolvedValue({
      commitHash: 'provider-hash',
      catalogRevision: 'catalog-from-commit',
    });
    const getEffectiveCatalog = vi.fn().mockResolvedValue({
      catalogRevision: 'catalog-live',
      models: [{ modelId: 'gpt-5.6-sol', routeRevision: 'route-sol' }],
    });

    const result = await buildConversationConfigurationCommit({
      selectedAgentId: 'edit',
      getEffectiveCatalog,
    });

    expect(flushAgentDefinitionSaves).toHaveBeenCalledWith({ agentId: 'edit', scope: 'user' });
    expect(flushProviderSaves).toHaveBeenCalledWith('openai');
    expect(result).toEqual({
      agentId: 'edit',
      providerId: 'openai',
      modelId: 'gpt-5.6-sol',
      configurationCommit: {
        agentId: 'edit',
        agentCommitHash: 'agent-hash',
        providerId: 'openai',
        modelId: 'gpt-5.6-sol',
        providerCommitHash: 'provider-hash',
        providerCatalogRevision: 'catalog-live',
        routeRevision: 'route-sol',
      },
    });
  });

  it('flushes the project lane when the effective profile is project-scoped', async () => {
    definitions.push({
      id: 'project-only',
      provenance: { scope: 'project', sourcePath: 'p.agent.md', sourceHash: 'h' },
    });
    flushAgentDefinitionSaves.mockResolvedValue({
      commitHash: 'project-hash',
      route: { providerId: 'openai', modelId: 'gpt-5.6-sol' },
    });
    flushProviderSaves.mockResolvedValue({ commitHash: 'provider-hash' });
    await buildConversationConfigurationCommit({
      selectedAgentId: 'project-only',
      currentProjectId: 'proj_b',
      getEffectiveCatalog: vi.fn().mockResolvedValue({
        catalogRevision: 'catalog-live',
        models: [{ modelId: 'gpt-5.6-sol', routeRevision: 'route-sol' }],
      }),
    });
    expect(flushAgentDefinitionSaves).toHaveBeenCalledWith({
      agentId: 'project-only',
      scope: 'project',
      projectId: 'proj_b',
    });
  });

  it('uses an explicit model override instead of the agent route', async () => {
    flushAgentDefinitionSaves.mockResolvedValue({
      commitHash: 'agent-hash',
      route: { providerId: 'openai', modelId: 'gpt-5.6-sol' },
    });
    flushProviderSaves.mockResolvedValue({ commitHash: 'kimi-hash' });
    const getEffectiveCatalog = vi.fn().mockResolvedValue({
      catalogRevision: 'kimi-catalog',
      models: [{ modelId: 'k3', routeRevision: 'k3-route' }],
    });

    const result = await buildConversationConfigurationCommit({
      selectedAgentId: 'ask',
      getEffectiveCatalog,
      modelOverride: { providerId: 'kimi-coding-plan', modelId: 'k3' },
    });

    expect(flushProviderSaves).toHaveBeenCalledWith('kimi-coding-plan');
    expect(result.providerId).toBe('kimi-coding-plan');
    expect(result.modelId).toBe('k3');
    expect(result.configurationCommit.routeRevision).toBe('k3-route');
  });
});
