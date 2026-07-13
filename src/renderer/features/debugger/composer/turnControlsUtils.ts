import type {
  ConversationTurnControls,
  ReasoningControl,
  ReasoningSelection,
} from '@shared/types/modelCapability';
import type { EffectiveModel } from '@shared/types/providerCapability';
import {
  clampReasoningSelection,
  coerceReasoningSelectionCandidate,
} from '@shared/types/modelCapability';

export const DEFAULT_TURN_CONTROLS: ConversationTurnControls = {
  reasoningLevel: 'off',
  maxContextMode: false,
  fastModel: false,
};

type TurnControlsInput = Partial<Omit<ConversationTurnControls, 'reasoningLevel'>> & {
  reasoningLevel?: unknown;
  effort?: unknown;
};

function normalizeTurnControls(
  controls: TurnControlsInput,
  reasoningControl: ReasoningControl,
): ConversationTurnControls {
  return {
    reasoningLevel: coerceReasoningSelectionCandidate(controls.reasoningLevel ?? controls.effort, reasoningControl)
      ?? reasoningControl.defaultSelection,
    maxContextMode: controls.maxContextMode === true,
    fastModel: controls.fastModel === true,
  };
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000;
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const thousands = value / 1_000;
    return Number.isInteger(thousands) ? `${thousands}k` : `${thousands.toFixed(1)}k`;
  }
  return `${value}`;
}

export function sanitizeTurnControls(
  controls: TurnControlsInput,
  capability: EffectiveModel | null,
): ConversationTurnControls {
  const reasoningControl = capability?.reasoning ?? {
    kind: 'none',
    supportsOff: true,
    levels: [],
    defaultSelection: 'off' as ReasoningSelection,
    wireProfile: { kind: 'none' as const },
  };
  const normalized = normalizeTurnControls(controls, reasoningControl);
  const reasoningLevel = clampReasoningSelection(normalized.reasoningLevel, reasoningControl)
    ?? reasoningControl.defaultSelection;

  return {
    reasoningLevel,
    maxContextMode: normalized.maxContextMode && hasSelectableMaxTier(capability),
    fastModel: normalized.fastModel && hasSelectableFastMode(capability),
  };
}

export function hasSelectableMaxTier(capability: EffectiveModel | null): boolean {
  if (!capability) return false;
  return capability.contextTiers.filter((tier) => tier.entitlement !== 'denied').length >= 2;
}

export function maxContextTokens(capability: EffectiveModel | null): number | undefined {
  return capability?.contextTiers
    .filter((tier) => tier.entitlement !== 'denied')
    .reduce<number | undefined>((max, tier) => (
      typeof tier.maxPromptTokens === 'number' ? Math.max(max ?? 0, tier.maxPromptTokens) : max
    ), undefined);
}

export function isMaxTierUnverified(capability: EffectiveModel | null): boolean {
  if (!capability) return false;
  const usable = capability.contextTiers.filter((tier) => tier.entitlement !== 'denied');
  return usable.length >= 2 && usable[usable.length - 1]?.entitlement === 'unknown';
}

export function hasSelectableFastMode(capability: EffectiveModel | null): boolean {
  return Boolean(capability
    && capability.fast.kind !== 'unsupported'
    && capability.fast.kind !== 'unknown'
    && capability.fast.entitlement !== 'denied');
}

export function isFastModeUnverified(capability: EffectiveModel | null): boolean {
  return Boolean(capability
    && capability.fast.kind !== 'unsupported'
    && capability.fast.kind !== 'unknown'
    && capability.fast.entitlement === 'unknown');
}

export function buildInitialTurnControls(
  capability: EffectiveModel | null,
  sessionControls?: TurnControlsInput | null,
): ConversationTurnControls {
  if (sessionControls) {
    return sanitizeTurnControls(sessionControls, capability);
  }
  if (capability) {
    return {
      reasoningLevel: capability.reasoning.defaultSelection,
      maxContextMode: false,
      fastModel: false,
    };
  }
  return DEFAULT_TURN_CONTROLS;
}
