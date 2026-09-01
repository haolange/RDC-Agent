import { describe, expect, it, vi } from 'vitest';
import type { AgentDefinitionSaveRequest, AgentManifestDefinition } from '@shared/types/agentManifest';
import { createSettingsModalActions } from './settingsModalActions';

const draft = {
  id: 'project-only',
  fileName: 'project-only.agent.md',
  name: 'Project Only',
  description: '',
  argumentHint: '',
  target: 'rdc-agent',
  models: ['openai:gpt'],
  icon: 'message-orbit' as const,
  accent: '#33d1ff',
  disableModelInvocation: false,
  userInvocable: true,
  tools: [],
  skills: [],
  mcpServers: [],
  agents: [],
  handoffs: [],
  metadata: {},
  instructions: '',
  enabled: true,
  writeScope: 'project' as const,
  writeProjectId: 'proj_demo',
  sourceHash: 'hash-1',
};

describe('settingsModalActions project scope save', () => {
  it('writes project scope+projectId instead of a user override', async () => {
    const saveAgentDefinition = vi.fn(async (request: AgentDefinitionSaveRequest) => ({
      clientRevision: request.clientRevision,
      status: 'committed' as const,
      commitHash: 'ok',
      definition: null,
      route: null,
      lastSuccessful: null,
    }));
    const actions = createSettingsModalActions({
      modalState: {
        agentManifestDrafts: [draft],
        setAgentManifestDrafts: vi.fn(),
        setAgentManifestSaveState: vi.fn(),
        setAgentManifestSaveMessage: vi.fn(),
      } as never,
      providerConnection: {} as never,
      updateProfile: vi.fn(async () => undefined),
      patchSettings: vi.fn(async (settings) => settings as never),
      saveAgentDefinition,
      currentProjectId: 'proj_demo',
      t: (key: string) => key,
    });

    await actions.handleSaveAgentManifests({
      drafts: [draft],
      clientRevision: 7,
    });

    expect(saveAgentDefinition).toHaveBeenCalledWith({
      draft,
      clientRevision: 7,
      scope: 'project',
      projectId: 'proj_demo',
      sourceHash: 'hash-1',
    });
  });

  it('replaces a deleted project general draft with the restored builtin definition', async () => {
    const deleted = { ...draft, id: 'general', fileName: 'general.agent.md', delete: true as const };
    const restored: AgentManifestDefinition = {
      id: 'general',
      fileName: 'general.agent.md',
      filePath: 'builtin/general.agent.md',
      name: 'General',
      description: 'builtin',
      argumentHint: '',
      target: 'rdc-agent',
      models: [],
      icon: 'nodes',
      accent: '#33d1ff',
      disableModelInvocation: false,
      userInvocable: true,
      tools: ['read'],
      skills: [],
      mcpServers: [],
      agents: [],
      handoffs: [],
      metadata: {},
      instructions: 'builtin',
      builtin: true,
      enabled: true,
      provenance: { scope: 'builtin', sourcePath: 'builtin/general.agent.md', sourceHash: 'builtin-hash' },
      compiledRoute: { agentId: 'general', providerId: 'openrouter', modelId: 'anthropic/claude-3-sonnet' },
    };
    let drafts = [deleted];
    const saveAgentDefinition = vi.fn(async (request: AgentDefinitionSaveRequest) => ({
      clientRevision: request.clientRevision,
      status: 'committed' as const,
      commitHash: 'ok',
      definition: restored,
      route: restored.compiledRoute ?? null,
      lastSuccessful: null,
    }));
    const actions = createSettingsModalActions({
      modalState: {
        agentManifestDrafts: drafts,
        setAgentManifestDrafts: (updater: (current: typeof drafts) => typeof drafts) => {
          drafts = updater(drafts);
        },
        setAgentManifestSaveState: vi.fn(),
        setAgentManifestSaveMessage: vi.fn(),
      } as never,
      providerConnection: {} as never,
      updateProfile: vi.fn(async () => undefined),
      patchSettings: vi.fn(async (settings) => settings as never),
      saveAgentDefinition,
      currentProjectId: 'proj_demo',
      t: (key: string) => key,
    });

    await actions.handleSaveAgentManifests({
      drafts: [deleted],
      clientRevision: 8,
    });

    expect(drafts).toEqual([expect.objectContaining({
      id: 'general',
      writeScope: 'user',
      sourceHash: 'builtin-hash',
    })]);
    expect(drafts[0]?.delete).toBeUndefined();
    expect(saveAgentDefinition).toHaveBeenCalledTimes(1);
  });

  it('does not call saveAgentDefinition when Retry / handleSaveAgentManifests() is blocked', async () => {
    const illegal = {
      ...draft,
      handoffs: [{ label: 'WIP', agent: '', prompt: '' }],
    };
    const saveAgentDefinition = vi.fn();
    const setAgentManifestSaveBlocked = vi.fn();
    const setAgentManifestSaveState = vi.fn();
    const setAgentManifestSaveMessage = vi.fn();
    const actions = createSettingsModalActions({
      modalState: {
        agentManifestDrafts: [illegal],
        setAgentManifestDrafts: vi.fn(),
        setAgentManifestSaveState,
        setAgentManifestSaveMessage,
        setAgentManifestSaveBlocked,
      } as never,
      providerConnection: {} as never,
      updateProfile: vi.fn(async () => undefined),
      patchSettings: vi.fn(async (settings) => settings as never),
      saveAgentDefinition,
      currentProjectId: 'proj_demo',
      t: (key: string) => key,
      blockSubmit: () => 'blocked',
      blockProjectedSubmit: () => null,
    });

    const result = await actions.handleSaveAgentManifests();

    expect(result).toBeNull();
    expect(saveAgentDefinition).not.toHaveBeenCalled();
    expect(setAgentManifestSaveBlocked).toHaveBeenCalledWith(true);
    expect(setAgentManifestSaveState).toHaveBeenCalledWith('error');
    expect(setAgentManifestSaveMessage).toHaveBeenCalledWith('blocked');
  });
});
