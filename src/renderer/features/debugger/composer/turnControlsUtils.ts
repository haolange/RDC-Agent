import type {
  ConversationTurnControls,
  ReasoningLevel,
  ResolvedModelCapability,
} from '@shared/types/modelCapability';
import { clampReasoningLevel, isReasoningLevel } from '@shared/types/modelCapability';

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
  defaultReasoningLevel: ReasoningLevel = DEFAULT_TURN_CONTROLS.reasoningLevel,
): ConversationTurnControls {
  const candidate = controls.reasoningLevel ?? controls.effort;
  return {
    reasoningLevel: isReasoningLevel(candidate) ? candidate : defaultReasoningLevel,
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
  capability: ResolvedModelCapability | null,
): ConversationTurnControls {
  const defaultReasoningLevel = capability?.defaultReasoningLevel ?? DEFAULT_TURN_CONTROLS.reasoningLevel;
  const normalized = normalizeTurnControls(controls, defaultReasoningLevel);
  if (!capability) {
    return normalized;
  }

  const supportedReasoningLevels: ReasoningLevel[] = Array.isArray(capability.supportedReasoningLevels)
    ? capability.supportedReasoningLevels
    : ['off'];
  const reasoningLevel = clampReasoningLevel(normalized.reasoningLevel, supportedReasoningLevels)
    ?? defaultReasoningLevel;

  return {
    reasoningLevel,
    maxContextMode: normalized.maxContextMode && capability.maxContextAvailable,
    fastModel: normalized.fastModel && capability.fastModelAvailable,
  };
}

export function buildInitialTurnControls(
  capability: ResolvedModelCapability | null,
  sessionControls?: TurnControlsInput | null,
): ConversationTurnControls {
  if (sessionControls) {
    return sanitizeTurnControls(sessionControls, capability);
  }
  if (capability) {
    return {
      reasoningLevel: capability.defaultReasoningLevel ?? 'off',
      maxContextMode: false,
      fastModel: false,
    };
  }
  return DEFAULT_TURN_CONTROLS;
}
