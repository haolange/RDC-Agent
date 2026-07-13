import type {
  ConversationTurnControls,
} from '@shared/types/modelCapability';
import type { EffectiveModel } from '@shared/types/providerCapability';
import {
  contextTierPromptCap,
  resolveContextTierChoices,
} from '@shared/utils/contextTiers';
import { evaluateModelControls, isFastModeSelectable } from '@shared/utils/modelControls';

export const DEFAULT_TURN_CONTROLS: ConversationTurnControls = {
  reasoningLevel: 'off',
  maxContextMode: false,
  fastModel: false,
};

type TurnControlsInput = Partial<Omit<ConversationTurnControls, 'reasoningLevel'>> & {
  reasoningLevel?: unknown;
};

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
  if (!capability) return DEFAULT_TURN_CONTROLS;
  return evaluateModelControls(capability, controls).controls;
}

export function hasSelectableMaxTier(capability: EffectiveModel | null): boolean {
  return Boolean(capability && resolveContextTierChoices(capability).maxTier);
}

export function maxContextTokens(capability: EffectiveModel | null): number | undefined {
  if (!capability) return undefined;
  const tier = resolveContextTierChoices(capability).maxTier;
  return tier ? contextTierPromptCap(tier) : undefined;
}

export function isMaxTierUnverified(capability: EffectiveModel | null): boolean {
  return Boolean(capability && resolveContextTierChoices(capability).maxTierUnverified);
}

export function hasSelectableFastMode(capability: EffectiveModel | null): boolean {
  return Boolean(capability && isFastModeSelectable(capability));
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
