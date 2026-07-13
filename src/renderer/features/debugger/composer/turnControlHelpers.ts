import type {
  ConversationTurnControls,
} from '@shared/types/modelCapability';
import type { EffectiveModel } from '@shared/types/providerCapability';
import {
  buildInitialTurnControls,
  sanitizeTurnControls,
} from './turnControlsUtils';

type SessionTurnControlsInput = Parameters<typeof buildInitialTurnControls>[1];

export interface TurnControlsSyncFingerprint {
  sessionId: string | null;
  capabilityKey: string;
  sessionControlsKey: string;
}

export function buildSessionTurnControlsKey(sessionControls: SessionTurnControlsInput): string {
  if (!sessionControls) {
    return 'none';
  }
  return JSON.stringify({
    reasoningLevel: sessionControls.reasoningLevel ?? null,
    maxContextMode: sessionControls.maxContextMode === true,
    fastModel: sessionControls.fastModel === true,
  });
}

export function shouldResyncTurnControls(
  previous: TurnControlsSyncFingerprint,
  next: TurnControlsSyncFingerprint,
): boolean {
  return previous.sessionId !== next.sessionId
    || previous.capabilityKey !== next.capabilityKey
    || previous.sessionControlsKey !== next.sessionControlsKey;
}

export function isPendingCapabilityKey(capabilityKey: string): boolean {
  return capabilityKey.endsWith(':pending');
}

export function resolveTurnControlsForCapabilityChange(input: {
  previousCapabilityKey: string | null;
  nextCapabilityKey: string;
  sessionChanged: boolean;
  sessionControlsChanged: boolean;
  capability: EffectiveModel | null;
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

  if (sessionChanged || sessionControlsChanged || isPendingCapabilityKey(previousCapabilityKey ?? '')) {
    return buildInitialTurnControls(capability, sessionControls);
  }

  if (previousCapabilityKey !== nextCapabilityKey) {
    if (rememberedControls) {
      return sanitizeTurnControls(rememberedControls, capability);
    }
    return buildInitialTurnControls(capability, null);
  }

  return sanitizeTurnControls(input.currentControls, capability);
}
