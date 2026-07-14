import { describe, expect, it } from 'vitest';
import type { AgentManifestDefinition, AgentManifestDraft } from '@shared/types/agentManifest';
import { DEFAULT_SETTINGS } from './defaultAppSettings';
import {
  beginAgentDefinitionSave,
  isLatestAgentDefinitionRevision,
  rollbackAgentDefinitionSave,
  settleAgentDefinitionSave,
} from './agentDefinitionSettings';

const definition = (modelId: string): AgentManifestDefinition => ({
  id: 'ask',
  fileName: 'ask.agent.md',
  filePath: 'C:/agents/ask.agent.md',
  name: 'Ask',
  description: '',
  argumentHint: '',
  target: 'rdc-agent',
  models: [modelId],
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

const draft = (modelId: string): AgentManifestDraft => {
  const { filePath: _filePath, builtin: _builtin, updatedAt: _updatedAt, ...value } = definition(modelId);
  return value;
};

describe('agent definition optimistic settings projection', () => {
  it('keeps only the newest A to B to C revision authoritative', () => {
    const base = structuredClone(DEFAULT_SETTINGS);
    base.agents.definitions = [definition('provider:a')];
    base.llm.agentRoutes = [{ agentId: 'ask', providerId: 'provider', modelId: 'a' }];

    const a = beginAgentDefinitionSave(base, { draft: draft('provider:a'), clientRevision: 101 });
    const b = beginAgentDefinitionSave(a.settings, { draft: draft('provider:b'), clientRevision: 102 });
    const c = beginAgentDefinitionSave(b.settings, { draft: draft('provider:c'), clientRevision: 103 });

    expect(isLatestAgentDefinitionRevision('ask', 101)).toBe(false);
    expect(isLatestAgentDefinitionRevision('ask', 102)).toBe(false);
    expect(isLatestAgentDefinitionRevision('ask', 103)).toBe(true);
    expect(c.settings.llm.agentRoutes).toContainEqual({ agentId: 'ask', providerId: 'provider', modelId: 'c' });
  });

  it('settles or rolls back only the scoped agent route', () => {
    const base = structuredClone(DEFAULT_SETTINGS);
    base.agents.definitions = [definition('provider:a')];
    base.llm.agentRoutes = [{ agentId: 'ask', providerId: 'provider', modelId: 'a' }];
    const pending = beginAgentDefinitionSave(base, { draft: draft('provider:b'), clientRevision: 201 });
    const settled = settleAgentDefinitionSave(pending.settings, 'ask', {
      clientRevision: 201,
      applied: true,
      definition: definition('provider:b'),
      route: { agentId: 'ask', providerId: 'provider', modelId: 'b' },
    });
    expect(settled.agents.definitions[0].models).toEqual(['provider:b']);
    expect(rollbackAgentDefinitionSave(settled, 'ask', pending.rollback)).toMatchObject({
      agents: { definitions: [{ models: ['provider:a'] }] },
      llm: { agentRoutes: [{ agentId: 'ask', providerId: 'provider', modelId: 'a' }] },
    });
  });
});
