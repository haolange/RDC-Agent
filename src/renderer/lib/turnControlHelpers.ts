import { buildInitialTurnControls, sanitizeTurnControls } from './turnControlsUtils';
import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { EffectiveModel } from '@shared/types/providerCapability';
import type { LlmProviderEntry } from '@shared/types/settings';

type SessionTurnControlsInput = Parameters<typeof buildInitialTurnControls>[1];

export function buildSessionTurnControlsKey(sessionControls: SessionTurnControlsInput): string {
  if (!sessionControls) return 'none';
  return JSON.stringify({
    reasoningLevel: sessionControls.reasoningLevel ?? null,
    maxContextMode: sessionControls.maxContextMode === true,
    fastModel: sessionControls.fastModel === true,
  });
}

export function resolveTurnControlsForCapabilityChange(input: {
  previousCapabilityKey: string | null;
  nextCapabilityKey: string;
  sessionChanged: boolean;
  sessionControlsChanged: boolean;
  capability: EffectiveModel;
  sessionControls: SessionTurnControlsInput;
  currentControls: ConversationTurnControls;
  rememberedControls: ConversationTurnControls | undefined;
  sameModelRoute?: boolean;
}): ConversationTurnControls {
  const {
    previousCapabilityKey,
    nextCapabilityKey,
    sessionChanged,
    sessionControlsChanged,
    capability,
    sessionControls,
    rememberedControls,
  } = input;

  if (sessionChanged || sessionControlsChanged) {
    return buildInitialTurnControls(capability, sessionControls);
  }
  if (previousCapabilityKey === null && input.sameModelRoute)
    return sanitizeTurnControls(input.currentControls, capability);
  if (previousCapabilityKey === null)
    return rememberedControls
      ? sanitizeTurnControls(rememberedControls, capability)
      : buildInitialTurnControls(capability, sessionControls);
  if (previousCapabilityKey !== nextCapabilityKey) {
    if (input.sameModelRoute) return sanitizeTurnControls(input.currentControls, capability);
    return rememberedControls
      ? sanitizeTurnControls(rememberedControls, capability)
      : buildInitialTurnControls(capability, null);
  }
  return sanitizeTurnControls(input.currentControls, capability);
}

/**
 * Identity of the route a model resolves to (provider, model, account, protocol, preferred route option); a change
 * means its capability must be resolved again. Empty while no model is chosen or its provider is unknown.
 */
export function routeFingerprint(
  providers: readonly LlmProviderEntry[],
  providerId?: string,
  modelId?: string,
): string {
  const provider = providerId ? providers.find((entry) => entry.id === providerId) : null;
  if (!providerId || !modelId || !provider) return '';
  const preference = provider.models.find((entry) => entry.id === modelId);
  return [
    providerId,
    modelId,
    provider.activeAccountId ?? `anonymous:${provider.id}`,
    provider.protocol,
    preference?.preferredRouteOptionId ?? '',
  ].join('\u001f');
}

/**
 * The keys a capability is remembered under: the Agent's resolved route with its catalog and route revisions, and the
 * model route alone (provider, model, protocol), which survives a revision change.
 */
export function capabilityKeys(
  agentId: string,
  capability: EffectiveModel | null,
): { capabilityKey: string | null; routeIdentity: string | null } {
  if (!capability) return { capabilityKey: null, routeIdentity: null };
  const routeIdentity = `${capability.providerId}:${capability.modelId}:${capability.route.protocol}`;
  return {
    capabilityKey: `${agentId}:${routeIdentity}:${capability.catalogRevision}:${capability.routeRevision}`,
    routeIdentity,
  };
}
