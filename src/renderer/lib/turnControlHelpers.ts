import type { ConversationTurnControls } from '@shared/types/modelCapability';
import type { EffectiveModel } from '@shared/types/providerCapability';
import { buildInitialTurnControls, sanitizeTurnControls } from './turnControlsUtils';

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

  if (sessionChanged || sessionControlsChanged || previousCapabilityKey === null) {
    return buildInitialTurnControls(capability, sessionControls);
  }
  if (previousCapabilityKey !== nextCapabilityKey) {
    return rememberedControls
      ? sanitizeTurnControls(rememberedControls, capability)
      : buildInitialTurnControls(capability, null);
  }
  return sanitizeTurnControls(input.currentControls, capability);
}
