import type {
  ConversationTurnControls,
  ReasoningControl,
  ReasoningSelection,
  ResolvedModelCapability,
} from '@shared/types/modelCapability';
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
  capability: ResolvedModelCapability | null,
): ConversationTurnControls {
  const reasoningControl = capability?.reasoningControl ?? {
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
    maxContextMode: normalized.maxContextMode && Boolean(capability?.maxContextAvailable),
    fastModel: normalized.fastModel && Boolean(capability?.fastModelAvailable),
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
      reasoningLevel: capability.reasoningControl.defaultSelection,
      maxContextMode: false,
      fastModel: false,
    };
  }
  return DEFAULT_TURN_CONTROLS;
}
