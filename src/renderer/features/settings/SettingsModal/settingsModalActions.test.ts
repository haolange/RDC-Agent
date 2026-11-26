import { describe, expect, it, vi } from 'vitest';
import { createSettingsModalActions } from './settingsModalActions';
import type { AgentDefinitionSaveRequest, AgentManifestDefinition } from '@shared/types/agentManifest';

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
    const saveAgentDefinition = vi.fn(async (_request: Omit<AgentDefinitionSaveRequest, 'clientRevision'>) => ({
      clientRevision: 1,
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
      adoptView: vi.fn(),
      rebaseAgentDrafts: vi.fn(),
    });

    await actions.handleSaveAgentManifests({ drafts: [draft] });

    expect(saveAgentDefinition).toHaveBeenCalledWith({
      draft,
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
    const saveAgentDefinition = vi.fn(async (_request: Omit<AgentDefinitionSaveRequest, 'clientRevision'>) => ({
      clientRevision: 1,
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
      adoptView: vi.fn(),
      rebaseAgentDrafts: vi.fn(),
    });

    await actions.handleSaveAgentManifests({ drafts: [deleted] });

    expect(drafts).toEqual([
      expect.objectContaining({
        id: 'general',
        writeScope: 'user',
        sourceHash: 'builtin-hash',
      }),
    ]);
    expect(drafts[0]?.delete).toBeUndefined();
    expect(saveAgentDefinition).toHaveBeenCalledTimes(1);
  });

  it('rejects a blocked explicit batch without calling saveAgentDefinition', async () => {
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
      adoptView: vi.fn(),
      rebaseAgentDrafts: vi.fn(),
      blockSubmit: () => 'blocked',
      blockProjectedSubmit: () => null,
    });

    await expect(actions.handleSaveAgentManifests({ drafts: [illegal] })).rejects.toThrow('blocked');
    expect(saveAgentDefinition).not.toHaveBeenCalled();
    expect(setAgentManifestSaveState).not.toHaveBeenCalled();
  });
});

describe('settingsModalActions personalization autosave', () => {
  it('keeps text typed while the save was in flight and adopts the saved text otherwise', async () => {
    let draft = 'first';
    const setGlobalInstructionsDraft = vi.fn((next: string | ((current: string) => string)) => {
      draft = typeof next === 'function' ? next(draft) : next;
    });
    let release: () => void = () => undefined;
    const patchSettings = vi.fn(
      (ops: Array<{ op: string; value: string }>) =>
        new Promise((resolve) => {
          release = () =>
            resolve({ agents: { globalInstructions: ops.find((op) => op.op === 'globalInstructions')?.value.trim() } });
        }),
    );
    const modalState = {
      get globalInstructionsDraft() {
        return draft;
      },
      setGlobalInstructionsDraft,
    };
    const actions = createSettingsModalActions({
      modalState: modalState as never,
      providerConnection: {} as never,
      updateProfile: vi.fn(async () => undefined),
      patchSettings: patchSettings as never,
      saveAgentDefinition: vi.fn() as never,
      t: (key: string) => key,
      adoptView: vi.fn(),
      rebaseAgentDrafts: vi.fn(),
    });

    const saving = actions.handleSavePersonalization();
    draft = 'first and more';
    release();
    await saving;
    expect(draft).toBe('first and more');

    draft = ' settled ';
    const settled = actions.handleSavePersonalization();
    release();
    await settled;
    expect(draft).toBe('settled');
  });
});
