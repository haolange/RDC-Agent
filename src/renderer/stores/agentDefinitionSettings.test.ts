import { describe, expect, it } from 'vitest';
import { createDefaultAppSettings } from '@shared/constants/appSettingsDefaults';
import { agentDefinitionCommit, agentDefinitionOverlay } from './agentDefinitionSettings';
import { SettingsIntents } from './settingsIntents';
import type { AgentManifestDefinition, AgentManifestDraft } from '@shared/types/agentManifest';

const DEFAULT_SETTINGS = createDefaultAppSettings();

/** Revisions differ by instructions; the route belongs to Settings and must not move on a save. */
const definition = (label: string): AgentManifestDefinition => ({
  id: 'ask',
  fileName: 'ask.agent.md',
  filePath: 'C:/agents/ask.agent.md',
  name: 'Ask',
  description: '',
  argumentHint: '',
  target: 'rdc-agent',
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
  instructions: label,
  builtin: false,
  enabled: true,
});

const draft = (label: string): AgentManifestDraft => {
  const { filePath: _filePath, builtin: _builtin, updatedAt: _updatedAt, ...value } = definition(label);
  return value;
};

describe('agent definition settings overlays', () => {
  const base = () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.agents.definitions = [definition('provider:a')];
    settings.llm.agentRoutes = [{ agentId: 'ask', providerId: 'provider', modelId: 'a' }];
    return settings;
  };

  it('shows the newest of A, B and C over the confirmed definition without moving the Settings route', () => {
    const intents = new SettingsIntents(base());
    intents.begin(agentDefinitionOverlay({ draft: draft('provider:a'), clientRevision: 101, scope: 'user' }));
    intents.begin(agentDefinitionOverlay({ draft: draft('provider:b'), clientRevision: 102, scope: 'user' }));
    const c = intents.begin(agentDefinitionOverlay({ draft: draft('provider:c'), clientRevision: 103, scope: 'user' }));
    expect(c.settings.agents.definitions[0].instructions).toBe('provider:c');
    expect(c.settings.llm.agentRoutes).toEqual([{ agentId: 'ask', providerId: 'provider', modelId: 'a' }]);
  });

  it("folds main's commit into the confirmed settings, and a failure only drops its own overlay", () => {
    const intents = new SettingsIntents(base());
    const b = intents.begin(agentDefinitionOverlay({ draft: draft('provider:b'), clientRevision: 201, scope: 'user' }));
    const c = intents.begin(agentDefinitionOverlay({ draft: draft('provider:c'), clientRevision: 202, scope: 'user' }));
    const committed = intents.settle(
      b.id,
      agentDefinitionCommit('ask', {
        definition: definition('provider:b'),
        route: { agentId: 'ask', providerId: 'provider', modelId: 'b' },
      }),
    );
    // C is still in flight, so it still shows; B's route is confirmed.
    expect(committed).toMatchObject({
      agents: { definitions: [{ instructions: 'provider:c' }] },
      llm: { agentRoutes: [{ agentId: 'ask', providerId: 'provider', modelId: 'b' }] },
    });
    expect(intents.fail(c.id).agents.definitions[0].instructions).toBe('provider:b');
  });

  it('hides a deleted Agent and its route while the deletion is in flight', () => {
    const intents = new SettingsIntents(base());
    const deletion = intents.begin(
      agentDefinitionOverlay({ draft: { ...draft('provider:a'), delete: true }, clientRevision: 1, scope: 'user' }),
    );
    expect(deletion.settings.agents.definitions).toEqual([]);
    expect(deletion.settings.llm.agentRoutes).toEqual([]);
    expect(intents.fail(deletion.id).agents.definitions).toHaveLength(1);
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
      builtin: true,
      provenance: { scope: 'builtin', sourcePath: 'builtin/general.agent.md', sourceHash: 'builtin-hash' },
      compiledRoute: { agentId: 'general', providerId: '', modelId: '' },
    };
    restoredBuiltin.compiledRoute = {
      agentId: 'general',
      providerId: 'openrouter',
      modelId: 'anthropic/claude-3-sonnet',
    };
    const base = structuredClone(DEFAULT_SETTINGS);
    base.agents.definitions = [projectOverride];
    const settled = agentDefinitionCommit('general', {
      definition: restoredBuiltin,
      route: restoredBuiltin.compiledRoute,
    })(base);
    const general = settled.agents.definitions.find((entry) => entry.id === 'general');
    expect(general).toMatchObject({
      builtin: true,
      compiledRoute: { agentId: 'general', providerId: 'openrouter', modelId: 'anthropic/claude-3-sonnet' },
      provenance: { scope: 'builtin', sourceHash: 'builtin-hash' },
    });
  });
});
