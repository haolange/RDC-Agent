import { describe, expect, it, vi } from 'vitest';
import type {
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
  AgentManifestDraft,
} from '@shared/types/agentManifest';
import { AgentDefinitionMutationCoordinator } from './AgentDefinitionMutationCoordinator';

const draft = (model: string): AgentManifestDraft => ({
  id: 'ask',
  fileName: 'ask.agent.md',
  name: 'Ask',
  description: '',
  argumentHint: '',
  target: 'rdc-agent',
  models: [model],
  icon: 'message-orbit',
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
});

const committed = (request: AgentDefinitionSaveRequest): AgentDefinitionSaveResult => {
  const modelId = request.draft.models[0]?.split(':')[1] ?? '';
  const route = { agentId: 'ask' as const, providerId: 'provider', modelId };
  const snapshot = {
    clientRevision: request.clientRevision,
    commitHash: `commit-${modelId}`,
    definition: null,
    route,
  };
  return {
    clientRevision: request.clientRevision,
    status: 'committed',
    commitHash: snapshot.commitHash,
    definition: null,
    route,
    lastSuccessful: snapshot,
  };
};

describe('AgentDefinitionMutationCoordinator', () => {
  it('debounces A -> B -> C and flushes only the latest revision', async () => {
    const commit = vi.fn(async (request: AgentDefinitionSaveRequest) => committed(request));
    const coordinator = new AgentDefinitionMutationCoordinator(commit, 60_000);
    const a = coordinator.enqueue({ draft: draft('provider:a'), clientRevision: 1 });
    const b = coordinator.enqueue({ draft: draft('provider:b'), clientRevision: 2 });
    const c = coordinator.enqueue({ draft: draft('provider:c'), clientRevision: 3 });

    const barrier = await coordinator.flush('ask');
    const results = await Promise.all([a, b, c]);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]?.[0].clientRevision).toBe(3);
    expect(results.map((result) => result.status)).toEqual(['superseded', 'superseded', 'committed']);
    expect(barrier?.commitHash).toBe('commit-c');
  });

  it('makes the flush barrier fail when the newest commit fails', async () => {
    const failed: AgentDefinitionSaveResult = {
      clientRevision: 4,
      status: 'failed',
      commitHash: 'commit-c',
      definition: null,
      route: { agentId: 'ask', providerId: 'provider', modelId: 'c' },
      lastSuccessful: {
        clientRevision: 3,
        commitHash: 'commit-c',
        definition: null,
        route: { agentId: 'ask', providerId: 'provider', modelId: 'c' },
      },
      error: 'disk full',
    };
    const coordinator = new AgentDefinitionMutationCoordinator(async () => failed, 60_000);
    const pending = coordinator.enqueue({ draft: draft('provider:d'), clientRevision: 4 });

    await expect(coordinator.flush('ask')).rejects.toThrow('disk full');
    await expect(pending).resolves.toMatchObject({ status: 'failed', error: 'disk full' });
  });
});
