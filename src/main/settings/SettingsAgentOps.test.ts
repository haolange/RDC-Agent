import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveDefinition = vi.fn();
const readDefinition = vi.fn();
const readCommitHash = vi.fn();
const routeFromDefinition = vi.fn((definition: { id: string }) => ({
  agentId: definition.id,
  providerId: 'openai',
  modelId: 'gpt',
}));

vi.mock('../runtime/AppPathService', () => ({
  appPathService: {
    getRuntimePaths: () => ({ agentsPath: 'C:/agents', instructionsPath: 'C:/instructions' }),
  },
}));

vi.mock('./AgentManifestService', () => ({
  agentManifestService: {
    saveDefinition: (...args: unknown[]) => saveDefinition(...args),
    readDefinition: (...args: unknown[]) => readDefinition(...args),
    readCommitHash: (...args: unknown[]) => readCommitHash(...args),
    routeFromDefinition: (definition: { id: string }) => routeFromDefinition(definition),
  },
}));

vi.mock('./resolveRegisteredProjectRoot', () => ({
  resolveRegisteredProjectRoot: (projectId?: string) => `D:/projects/${projectId}`,
}));

import { SettingsAgentOps } from './SettingsAgentOps';
import type { AgentManifestDraft } from '@shared/types/agentManifest';

const draft = (id = 'general'): AgentManifestDraft => ({
  id,
  fileName: `${id}.agent.md`,
  name: id,
  description: '',
  argumentHint: '',
  target: 'rdc-agent',
  models: ['openai:gpt'],
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

describe('SettingsAgentOps scope isolation', () => {
  beforeEach(() => {
    saveDefinition.mockReset();
    readDefinition.mockReset();
    readCommitHash.mockReset();
    readDefinition.mockResolvedValue(null);
    readCommitHash.mockResolvedValue('hash');
    saveDefinition.mockImplementation(async (_paths: unknown, nextDraft: AgentManifestDraft) => ({
      definition: { ...nextDraft, filePath: 'C:/tmp.agent.md', builtin: false },
      commitHash: `commit-${nextDraft.models[0]}`,
    }));
  });

  it('does not let a user revision supersede a project revision of the same agentId', async () => {
    const ops = new SettingsAgentOps();
    const user = await ops.saveAgentDefinition({
      draft: { ...draft(), models: ['openai:user'] },
      clientRevision: 1,
      scope: 'user',
    });
    const project = await ops.saveAgentDefinition({
      draft: { ...draft(), models: ['openai:project'] },
      clientRevision: 1,
      scope: 'project',
      projectId: 'proj_a',
    });
    expect(user.status).toBe('committed');
    expect(project.status).toBe('committed');
    expect(saveDefinition).toHaveBeenCalledTimes(2);
    expect(saveDefinition.mock.calls[1]?.[2]).toMatchObject({
      scope: 'project',
      projectRoot: 'D:/projects/proj_a',
    });
  });
});
