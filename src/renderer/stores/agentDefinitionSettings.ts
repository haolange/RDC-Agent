import type { AgentDefinitionSaveRequest, AgentDefinitionSaveResult, AgentManifestDefinition } from '@shared/types/agentManifest';
import type { AppSettings, LlmAgentRoute } from '@shared/types/settings';
import { splitCanonicalAgentModelId } from '@shared/utils/agentModelRoute';

export interface AgentDefinitionRollback {
  definition: AgentManifestDefinition | null;
  route: LlmAgentRoute | null;
}

let lastClientRevision = 0;
const latestRevisions = new Map<string, number>();

export const nextAgentDefinitionClientRevision = (): number => {
  const clockRevision = Date.now() * 1_000;
  lastClientRevision = Math.max(clockRevision, lastClientRevision + 1);
  return lastClientRevision;
};

export const isLatestAgentDefinitionRevision = (agentId: string, clientRevision: number): boolean => (
  latestRevisions.get(agentId) === clientRevision
);

const replaceDefinition = (
  definitions: AgentManifestDefinition[],
  agentId: string,
  definition: AgentManifestDefinition | null,
): AgentManifestDefinition[] => {
  const index = definitions.findIndex((entry) => entry.id === agentId);
  if (!definition) return definitions.filter((entry) => entry.id !== agentId);
  if (index < 0) return [...definitions, definition];
  return definitions.map((entry, entryIndex) => entryIndex === index ? definition : entry);
};

const replaceRoute = (
  routes: LlmAgentRoute[],
  agentId: string,
  route: LlmAgentRoute | null,
): LlmAgentRoute[] => [
  ...routes.filter((entry) => entry.agentId !== agentId),
  ...(route ? [route] : []),
];

const projectSettings = (
  settings: AppSettings,
  agentId: string,
  definition: AgentManifestDefinition | null,
  route: LlmAgentRoute | null,
): AppSettings => ({
  ...settings,
  agents: { ...settings.agents, definitions: replaceDefinition(settings.agents.definitions, agentId, definition) },
  llm: { ...settings.llm, agentRoutes: replaceRoute(settings.llm.agentRoutes, agentId, route) },
});

export function beginAgentDefinitionSave(settings: AppSettings, request: AgentDefinitionSaveRequest): {
  settings: AppSettings;
  rollback: AgentDefinitionRollback;
} {
  const agentId = request.draft.id;
  const existing = settings.agents.definitions.find((entry) => entry.id === agentId) ?? null;
  const previousRoute = settings.llm.agentRoutes.find((entry) => entry.agentId === agentId) ?? null;
  const parsedModel = request.draft.models.map(splitCanonicalAgentModelId).find((entry) => entry !== null);
  const optimisticRoute = request.draft.delete
    ? null
    : parsedModel
      ? { agentId, providerId: parsedModel.providerId, modelId: parsedModel.modelId }
      : { agentId, providerId: '', modelId: '' };
  const optimisticDefinition = request.draft.delete || !existing
    ? null
    : { ...existing, ...request.draft } as AgentManifestDefinition;
  latestRevisions.set(agentId, request.clientRevision);
  return {
    settings: request.draft.delete
      ? projectSettings(settings, agentId, null, null)
      : projectSettings(settings, agentId, optimisticDefinition ?? existing, optimisticRoute),
    rollback: { definition: existing, route: previousRoute },
  };
}

export const settleAgentDefinitionSave = (
  settings: AppSettings,
  agentId: string,
  result: AgentDefinitionSaveResult,
): AppSettings => projectSettings(settings, agentId, result.definition, result.route);

export const rollbackAgentDefinitionSave = (
  settings: AppSettings,
  agentId: string,
  rollback: AgentDefinitionRollback,
): AppSettings => projectSettings(settings, agentId, rollback.definition, rollback.route);
