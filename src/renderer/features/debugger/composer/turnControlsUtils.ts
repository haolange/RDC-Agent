import type {
  ConversationTurnControls,
} from '@shared/types/modelCapability';
import type { EffectiveModel } from '@shared/types/providerCapability';
import {
  contextTierWindowTokens,
  resolveContextTierChoices,
} from '@shared/utils/contextTiers';
import { resolveModelControls } from '@shared/utils/modelControls';

export const DEFAULT_TURN_CONTROLS: ConversationTurnControls = {
  reasoningLevel: 'off',
  maxContextMode: false,
  fastModel: false,
};

type TurnControlsInput = Partial<Omit<ConversationTurnControls, 'reasoningLevel'>> & {
  reasoningLevel?: unknown;
};

export function sanitizeTurnControls(
  controls: TurnControlsInput,
  capability: EffectiveModel | null,
): ConversationTurnControls {
  if (!capability) return DEFAULT_TURN_CONTROLS;
  return resolveModelControls(capability, controls).controls;
}

export function hasSelectableMaxContext(capability: EffectiveModel | null): boolean {
  if (!capability) return false;
  const resolved = resolveModelControls(capability).resolved.maxContext;
  return resolved.state === 'selectable' && !resolved.disabled;
}

export function maxContextTokens(capability: EffectiveModel | null): number | undefined {
  if (!capability) return undefined;
  const maxTier = resolveContextTierChoices(capability).maxTier;
  return maxTier ? contextTierWindowTokens(maxTier) : undefined;
}

export function isMaxContextUnverified(capability: EffectiveModel | null): boolean {
  if (!capability) return false;
  const control = capability.controls.maxContext;
  return control.state === 'selectable' && control.entitlement === 'unknown';
}

export function isMaxContextDenied(capability: EffectiveModel | null): boolean {
  if (!capability) return false;
  const control = capability.controls.maxContext;
  return control.state === 'selectable' && control.entitlement === 'denied';
}

export function hasSelectableFastMode(capability: EffectiveModel | null): boolean {
  if (!capability) return false;
  const resolved = resolveModelControls(capability).resolved.fast;
  return resolved.state === 'selectable' && !resolved.disabled;
}

export function isFastModeUnverified(capability: EffectiveModel | null): boolean {
  if (!capability) return false;
  const control = capability.controls.fast;
  return control.state === 'selectable' && control.entitlement === 'unknown';
}

export function isFastModeDenied(capability: EffectiveModel | null): boolean {
  if (!capability) return false;
  const control = capability.controls.fast;
  return control.state === 'selectable' && control.entitlement === 'denied';
}

export function buildInitialTurnControls(
  capability: EffectiveModel | null,
  sessionControls?: TurnControlsInput | null,
): ConversationTurnControls {
  if (sessionControls) {
    return sanitizeTurnControls(sessionControls, capability);
  }
  if (capability) {
    return resolveModelControls(capability, {
      reasoningLevel: capability.controls.reasoning.defaultSelection,
      maxContextMode: false,
      fastModel: false,
    }).controls;
  }
  return DEFAULT_TURN_CONTROLS;
}
