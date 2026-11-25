import { appPathService } from '../../runtime/AppPathService';
import { agentManifestService } from '../agent-manifests/AgentManifestService';
import type { AgentManifestDefinition } from '@shared/types/agentManifest';
import type { LlmAgentRoute } from '@shared/types/settings';

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

export function resolveCompiledRouteForAgent(agentId: string, projectRoot?: string | null): LlmAgentRoute | null {
  const snapshot = agentManifestService.resolveEffectiveSnapshot(appPathService.getRuntimePaths(), projectRoot ?? undefined);
  return compiledRouteFromDefinition(snapshot.profiles.find((profile) => profile.id === agentId));
}
