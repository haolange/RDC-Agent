import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { LlmAgentRoute } from '@shared/types/settings';
import type { AppSettings } from '@shared/types/settings';
import { agentManifestService } from './AgentManifestService';

export function compiledRouteFromDefinition(
  definition: Pick<AgentManifestDefinition, 'id' | 'compiledRoute'> | null | undefined,
): LlmAgentRoute | null {
  const route = definition?.compiledRoute;
  if (!definition || !route?.providerId || !route.modelId) return null;
  return {
    agentId: definition.id,
    providerId: route.providerId,
    modelId: route.modelId,
  };
}

export function compiledRoutesFromDefinitions(
  definitions: Array<Pick<AgentManifestDefinition, 'id' | 'compiledRoute'>>,
): LlmAgentRoute[] {
  return definitions.flatMap((definition) => {
    const route = compiledRouteFromDefinition(definition);
    return route ? [route] : [];
  });
}

export function resolveCompiledRouteForAgent(
  agentId: string,
  settings: Pick<AppSettings, 'agents' | 'paths'>,
  projectRoot?: string | null,
): LlmAgentRoute | null {
  if (settings.paths?.agentsPath && settings.paths.instructionsPath) {
    const snapshot = agentManifestService.resolveEffectiveSnapshot(
      settings.paths,
      projectRoot ?? undefined,
    );
    return compiledRouteFromDefinition(snapshot.profiles.find((profile) => profile.id === agentId));
  }
  return compiledRouteFromDefinition(
    settings.agents.definitions.find((definition) => definition.id === agentId),
  );
}
