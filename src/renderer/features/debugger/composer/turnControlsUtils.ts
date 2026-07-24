import type {
  ConversationTurnControls,
} from '@shared/types/modelCapability';
import type { EffectiveModel } from '@shared/types/providerCapability';
import {
  ONE_MILLION_CONTEXT_TOKENS,
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

export function hasStructuralOneMillionContext(capability: EffectiveModel | null): boolean {
  if (!capability) return false;
  const state = capability.controls.context1m.state;
  return state === 'selectable' || state === 'fixed';
}

export function hasSelectableOneMillionContext(capability: EffectiveModel | null): boolean {
  if (!capability) return false;
  const resolved = resolveModelControls(capability).resolved.context1m;
  return resolved.state === 'selectable' && !resolved.disabled;
}

export function oneMillionContextTokens(capability: EffectiveModel | null): number | undefined {
  if (!capability) return undefined;
  return capability.controls.context1m.state === 'unsupported'
    || capability.controls.context1m.state === 'unknown'
    ? undefined
    : ONE_MILLION_CONTEXT_TOKENS;
}

export function isOneMillionContextUnverified(capability: EffectiveModel | null): boolean {
  if (!capability) return false;
  const control = capability.controls.context1m;
  return control.state === 'selectable' && control.entitlement === 'unknown';
}

export function isOneMillionContextDenied(capability: EffectiveModel | null): boolean {
  if (!capability) return false;
  const control = capability.controls.context1m;
  return control.state === 'selectable' && control.entitlement === 'denied';
}

export function hasStructuralFastMode(capability: EffectiveModel | null): boolean {
  if (!capability) return false;
  const state = capability.controls.fast.state;
  return state === 'selectable' || state === 'fixed';
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
