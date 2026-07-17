import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
  AgentManifestDefinition,
  AgentManifestDraft,
} from '@shared/types/agentManifest';
import { DEFAULT_SETTINGS } from './defaultAppSettings';
import { useAppSettingsStore } from './appSettingsStore';

const definition = (agentId: string, model: string): AgentManifestDefinition => ({
  id: agentId,
  fileName: `${agentId}.agent.md`,
  filePath: `C:/agents/${agentId}.agent.md`,
  name: agentId,
  description: '',
  argumentHint: '',
  target: 'rdc-agent',
  models: [model],
  icon: 'message-orbit',
  disableModelInvocation: false,
  userInvocable: true,
  tools: [],
  skills: [],
  mcpServers: [],
  agents: [],
  handoffs: [],
  metadata: {},
  instructions: '',
  builtin: false,
  enabled: true,
});

const draft = (value: AgentManifestDefinition, model: string): AgentManifestDraft => {
  const { filePath: _filePath, builtin: _builtin, updatedAt: _updatedAt, ...rest } = value;
  return { ...rest, models: [model] };
};

const committed = (request: AgentDefinitionSaveRequest): AgentDefinitionSaveResult => {
  const [providerId, modelId] = request.draft.models[0].split(':');
  const savedDefinition = definition(request.draft.id, request.draft.models[0]);
  const route = { agentId: request.draft.id, providerId, modelId };
  const snapshot = {
    clientRevision: request.clientRevision,
    commitHash: `commit-${modelId}`,
    definition: savedDefinition,
    route,
  };
  return {
    clientRevision: request.clientRevision,
    status: 'committed',
    commitHash: snapshot.commitHash,
    definition: savedDefinition,
    route,
    lastSuccessful: snapshot,
  };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('app settings Agent route sync state', () => {
  it('publishes saving and committed revisions even when optimistic route text is unchanged', async () => {
    vi.useFakeTimers();
    const agentId = 'route-sync-success';
    const original = definition(agentId, 'provider:model-a');
    const saveAgentDefinition = vi.fn(async (request: AgentDefinitionSaveRequest) => committed(request));
    vi.stubGlobal('window', { electronAPI: { settings: { saveAgentDefinition } } });
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.agents.definitions = [original];
    settings.llm.agentRoutes = [{ agentId, providerId: 'provider', modelId: 'model-a' }];
    useAppSettingsStore.getState().hydrate(settings, 'dark');

    const pending = useAppSettingsStore.getState().saveAgentDefinition({
      draft: draft(original, 'provider:model-b'),
      clientRevision: 501,
    });
    expect(useAppSettingsStore.getState().agentRouteSyncById[agentId]).toMatchObject({
      status: 'saving',
      clientRevision: 501,
    });

    await vi.advanceTimersByTimeAsync(120);
    await pending;
    expect(useAppSettingsStore.getState().agentRouteSyncById[agentId]).toEqual({
      status: 'committed',
      clientRevision: 501,
      commitHash: 'commit-model-b',
    });
    expect(saveAgentDefinition).toHaveBeenCalledTimes(1);
  });

  it('rolls back the route and publishes failed state for the newest revision', async () => {
    vi.useFakeTimers();
    const agentId = 'route-sync-failure';
    const original = definition(agentId, 'provider:model-a');
    const failure: AgentDefinitionSaveResult = {
      clientRevision: 601,
      status: 'failed',
      commitHash: 'commit-model-a',
      definition: original,
      route: { agentId, providerId: 'provider', modelId: 'model-a' },
      lastSuccessful: {
        clientRevision: 600,
        commitHash: 'commit-model-a',
        definition: original,
        route: { agentId, providerId: 'provider', modelId: 'model-a' },
      },
      error: 'write rejected',
    };
    vi.stubGlobal('window', {
      electronAPI: { settings: { saveAgentDefinition: vi.fn(async () => failure) } },
    });
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.agents.definitions = [original];
    settings.llm.agentRoutes = [{ agentId, providerId: 'provider', modelId: 'model-a' }];
    useAppSettingsStore.getState().hydrate(settings, 'dark');

    const pending = useAppSettingsStore.getState().saveAgentDefinition({
      draft: draft(original, 'provider:model-b'),
      clientRevision: 601,
    });
    const rejection = expect(pending).rejects.toThrow('write rejected');
    await vi.advanceTimersByTimeAsync(120);
    await rejection;
    expect(useAppSettingsStore.getState().settings.llm.agentRoutes).toContainEqual({
      agentId,
      providerId: 'provider',
      modelId: 'model-a',
    });
    expect(useAppSettingsStore.getState().agentRouteSyncById[agentId]).toEqual({
      status: 'failed',
      clientRevision: 601,
      commitHash: 'commit-model-a',
      error: 'write rejected',
    });
  });
});
