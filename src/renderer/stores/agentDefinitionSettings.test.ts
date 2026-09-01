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

    const a = beginAgentDefinitionSave(base, { draft: draft('provider:a'), clientRevision: 101, scope: 'user' });
    const b = beginAgentDefinitionSave(a.settings, { draft: draft('provider:b'), clientRevision: 102, scope: 'user' });
    const c = beginAgentDefinitionSave(b.settings, { draft: draft('provider:c'), clientRevision: 103, scope: 'user' });

    expect(isLatestAgentDefinitionRevision('user', undefined, 'ask', 101)).toBe(false);
    expect(isLatestAgentDefinitionRevision('user', undefined, 'ask', 102)).toBe(false);
    expect(isLatestAgentDefinitionRevision('user', undefined, 'ask', 103)).toBe(true);
    expect(c.settings.llm.agentRoutes).toContainEqual({ agentId: 'ask', providerId: 'provider', modelId: 'c' });
  });

  it('settles or rolls back only the scoped agent route', () => {
    const base = structuredClone(DEFAULT_SETTINGS);
    base.agents.definitions = [definition('provider:a')];
    base.llm.agentRoutes = [{ agentId: 'ask', providerId: 'provider', modelId: 'a' }];
    const pending = beginAgentDefinitionSave(base, { draft: draft('provider:b'), clientRevision: 201, scope: 'user' });
    const settled = settleAgentDefinitionSave(pending.settings, 'ask', {
      clientRevision: 201,
      status: 'committed',
      commitHash: 'commit-b',
      definition: definition('provider:b'),
      route: { agentId: 'ask', providerId: 'provider', modelId: 'b' },
      lastSuccessful: {
        clientRevision: 201,
        commitHash: 'commit-b',
        definition: definition('provider:b'),
        route: { agentId: 'ask', providerId: 'provider', modelId: 'b' },
      },
    });
    expect(settled.agents.definitions[0].models).toEqual(['provider:b']);
    expect(rollbackAgentDefinitionSave(settled, 'ask', {
      clientRevision: 200,
      commitHash: 'commit-a',
      definition: pending.rollback.definition,
      route: pending.rollback.route,
    })).toMatchObject({
      agents: { definitions: [{ models: ['provider:a'] }] },
      llm: { agentRoutes: [{ agentId: 'ask', providerId: 'provider', modelId: 'a' }] },
    });
  });

  it('upserts a restored builtin general after deleting a project override', () => {
    const projectOverride: AgentManifestDefinition = {
      ...definition('openai:project'),
      id: 'general',
      fileName: 'general.agent.md',
      builtin: false,
      provenance: { scope: 'project', sourcePath: 'project/general.agent.md', sourceHash: 'project-hash' },
      compiledRoute: { agentId: 'general', providerId: 'openai', modelId: 'project' },
    };
    const restoredBuiltin: AgentManifestDefinition = {
      ...definition(''),
      id: 'general',
      fileName: 'general.agent.md',
      models: [],
      builtin: true,
      provenance: { scope: 'builtin', sourcePath: 'builtin/general.agent.md', sourceHash: 'builtin-hash' },
      compiledRoute: { agentId: 'general', providerId: '', modelId: '' },
    };
    restoredBuiltin.compiledRoute = { agentId: 'general', providerId: 'openrouter', modelId: 'anthropic/claude-3-sonnet' };
    const base = structuredClone(DEFAULT_SETTINGS);
    base.agents.definitions = [projectOverride];
    const settled = settleAgentDefinitionSave(base, 'general', {
      clientRevision: 301,
      status: 'committed',
      commitHash: 'deleted-project',
      definition: restoredBuiltin,
      route: restoredBuiltin.compiledRoute,
      lastSuccessful: {
        clientRevision: 301,
        commitHash: 'deleted-project',
        definition: restoredBuiltin,
        route: restoredBuiltin.compiledRoute,
      },
    });
    const general = settled.agents.definitions.find((entry) => entry.id === 'general');
    expect(general).toMatchObject({
      builtin: true,
      compiledRoute: { agentId: 'general', providerId: 'openrouter', modelId: 'anthropic/claude-3-sonnet' },
      provenance: { scope: 'builtin', sourceHash: 'builtin-hash' },
    });
  });
});
