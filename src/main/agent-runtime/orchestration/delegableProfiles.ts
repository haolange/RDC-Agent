import type { AgentManifestDefinition } from '@shared/types/agentManifest';

/**
 * Profiles another agent may hand work to: enabled, and not marked `disable-model-invocation` (those run
 * only when a person selects them). A turn's declared delegates are intersected with this set.
 */
export function delegableProfileIds(
  profiles: ReadonlyArray<Pick<AgentManifestDefinition, 'id' | 'enabled' | 'disableModelInvocation'>>,
): string[] {
  return profiles.filter((profile) => profile.enabled && !profile.disableModelInvocation).map((profile) => profile.id);
}
