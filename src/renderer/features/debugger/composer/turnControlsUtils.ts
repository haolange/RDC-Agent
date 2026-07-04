import type {
  ConversationTurnControls,
  EffortLevel,
  ResolvedModelCapability,
} from '@shared/types/modelCapability';
import { clampEffortLevel } from '@shared/types/modelCapability';

export const DEFAULT_TURN_CONTROLS: ConversationTurnControls = {
  effort: 'medium',
  maxContextMode: false,
  fastModel: false,
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

export function effortFillToken(level: EffortLevel): string {
  const index = ['low', 'medium', 'high', 'extra', 'max'].indexOf(level);
  const step = Math.max(1, Math.min(5, index + 1));
  return `var(--token-effort-fill-${step})`;
}

export function sanitizeTurnControls(
  controls: ConversationTurnControls,
  capability: ResolvedModelCapability | null,
): ConversationTurnControls {
  if (!capability) {
    return controls;
  }

  const effort = capability.supportedEffortLevels.length === 0
    ? capability.defaultEffort
    : (clampEffortLevel(controls.effort, capability.supportedEffortLevels) ?? capability.defaultEffort);

  return {
    effort,
    maxContextMode: controls.maxContextMode && capability.maxContextAvailable,
    fastModel: controls.fastModel && capability.fastModelAvailable,
  };
}

export function buildInitialTurnControls(
  capability: ResolvedModelCapability | null,
  sessionControls?: ConversationTurnControls,
): ConversationTurnControls {
  if (sessionControls) {
    return sanitizeTurnControls(sessionControls, capability);
  }
  if (capability) {
    return {
      effort: capability.defaultEffort,
      maxContextMode: false,
      fastModel: false,
    };
  }
  return DEFAULT_TURN_CONTROLS;
}
