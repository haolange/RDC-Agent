import type {
  AgentDefinitionCommitSnapshot,
  AgentDefinitionSaveRequest,
  AgentManifestDefinition,
} from '@shared/types/agentManifest';
import type { AppSettings, LlmAgentRoute } from '@shared/types/settings';
import type { SettingsOverlay } from './settingsIntents';

const replaceDefinition = (
  definitions: AgentManifestDefinition[],
  agentId: string,
  definition: AgentManifestDefinition | null,
): AgentManifestDefinition[] => {
  const index = definitions.findIndex((entry) => entry.id === agentId);
  if (!definition) return definitions.filter((entry) => entry.id !== agentId);
  if (index < 0) return [...definitions, definition];
  return definitions.map((entry, entryIndex) => (entryIndex === index ? definition : entry));
};

const replaceRoute = (routes: LlmAgentRoute[], agentId: string, route: LlmAgentRoute | null): LlmAgentRoute[] => [
  ...routes.filter((entry) => entry.agentId !== agentId),
  ...(route ? [route] : []),
];

const withDefinition = (
  settings: AppSettings,
  agentId: string,
  definition: AgentManifestDefinition | null,
  route: LlmAgentRoute | null,
): AppSettings => ({
  ...settings,
  agents: { ...settings.agents, definitions: replaceDefinition(settings.agents.definitions, agentId, definition) },
  llm: { ...settings.llm, agentRoutes: replaceRoute(settings.llm.agentRoutes, agentId, route) },
});

/**
 * The definition shown while its save is in flight. A deletion hides the Agent and its route; an edit shows over the
 * definition it changes and keeps the route, which comes from Settings → Agents, not the manifest. A new Agent shows
 * once main has written it.
 */
export const agentDefinitionOverlay =
  (request: AgentDefinitionSaveRequest): SettingsOverlay =>
  (settings) => {
    const agentId = request.draft.id;
    if (request.draft.delete) return withDefinition(settings, agentId, null, null);
    const existing = settings.agents.definitions.find((entry) => entry.id === agentId);
    if (!existing) return settings;
    const route = settings.llm.agentRoutes.find((entry) => entry.agentId === agentId) ?? null;
    return withDefinition(settings, agentId, { ...existing, ...request.draft } as AgentManifestDefinition, route);
  };

/** The definition and route main committed. */
export const agentDefinitionCommit =
  (agentId: string, commit: Pick<AgentDefinitionCommitSnapshot, 'definition' | 'route'>): SettingsOverlay =>
  (settings) =>
    withDefinition(settings, agentId, commit.definition, commit.route);
