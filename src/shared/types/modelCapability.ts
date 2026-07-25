export type NamedReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export const NAMED_REASONING_LEVELS: readonly NamedReasoningLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

export type ReasoningSelection = 'off' | 'on' | NamedReasoningLevel;
export const REASONING_SELECTIONS: readonly ReasoningSelection[] = [
  'off',
  'on',
  ...NAMED_REASONING_LEVELS,
];

export type ReasoningControlKind = 'unknown' | 'none' | 'toggle' | 'levels' | 'always-on';

export type OpenAiWireEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type AnthropicWireEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type GeminiWireThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export type ReasoningWireProfile =
  | { kind: 'none' }
  | {
      kind: 'openai-responses';
      on: NamedReasoningLevel;
      levels: Partial<Record<NamedReasoningLevel, OpenAiWireEffort>>;
    }
  | {
      kind: 'openai-compatible';
      on: NamedReasoningLevel;
      levels?: Partial<Record<NamedReasoningLevel, string>>;
      onMode?: 'enable-thinking-true' | 'thinking-enabled' | 'enabled';
      offMode?: 'reasoning-none' | 'enable-thinking-false' | 'thinking-disabled' | 'disabled';
    }
  | {
      kind: 'anthropic';
      on: NamedReasoningLevel;
      levels?: Partial<Record<NamedReasoningLevel, AnthropicWireEffort>>;
      onMode?: 'adaptive' | 'enabled';
      onBudgetTokens?: number;
      offMode?: 'disabled';
    }
  | {
      kind: 'gemini-thinking-level';
      on: NamedReasoningLevel;
      levels: Partial<Record<NamedReasoningLevel, GeminiWireThinkingLevel>>;
    }
  | {
      kind: 'gemini-thinking-budget';
      on: NamedReasoningLevel;
      levels: Partial<Record<NamedReasoningLevel, number>>;
      offBudget?: 0;
    }
  | {
      kind: 'moonshot-thinking';
      onMode?: 'enabled';
      offMode?: 'disabled';
    };

export interface ReasoningControl {
  kind: ReasoningControlKind;
  supportsOff: boolean;
  levels: NamedReasoningLevel[];
  /**
   * Whether `defaultSelection` is an observed provider default or only the
   * deterministic local fallback used when the provider does not publish one.
   */
  defaultState?: 'known' | 'provider-managed' | 'unknown';
  defaultSelection: ReasoningSelection;
  lockedSelection?: ReasoningSelection;
  wireProfile: ReasoningWireProfile;
}

export interface ConversationTurnControls {
  reasoningLevel: ReasoningSelection;
  maxContextMode: boolean;
  fastModel: boolean;
}

export interface ResolvedReasoningSelection {
  selection: ReasoningSelection | 'unknown';
  control: ReasoningControl;
}

export const CONTEXT_COMPACTION_RATIO = 0.8;

export function isNamedReasoningLevel(value: unknown): value is NamedReasoningLevel {
  return typeof value === 'string' && (NAMED_REASONING_LEVELS as readonly string[]).includes(value);
}

export function isReasoningSelection(value: unknown): value is ReasoningSelection {
  return typeof value === 'string' && (REASONING_SELECTIONS as readonly string[]).includes(value);
}

export function createReasoningControl(control: ReasoningControl): ReasoningControl {
  return {
    ...control,
    levels: [...control.levels],
    wireProfile: cloneReasoningWireProfile(control.wireProfile),
  };
}

function cloneReasoningWireProfile(profile: ReasoningWireProfile): ReasoningWireProfile {
  switch (profile.kind) {
    case 'openai-responses':
      return {
        ...profile,
        levels: profile.levels ? { ...profile.levels } : profile.levels,
      };
    case 'openai-compatible':
      return {
        ...profile,
        levels: profile.levels ? { ...profile.levels } : profile.levels,
      };
    case 'anthropic':
      return {
        ...profile,
        levels: profile.levels ? { ...profile.levels } : profile.levels,
      };
    case 'gemini-thinking-level':
      return {
        ...profile,
        levels: { ...profile.levels },
      };
    case 'gemini-thinking-budget':
      return {
        ...profile,
        levels: { ...profile.levels },
      };
    case 'moonshot-thinking':
    case 'none':
    default:
      return { ...profile };
  }
}

export function getReasoningSelectionOrder(control: ReasoningControl | null | undefined): ReasoningSelection[] {
  if (!control) {
    return ['off'];
  }
  switch (control.kind) {
    case 'toggle':
      return ['off', 'on'];
    case 'always-on':
      return [control.lockedSelection ?? 'on'];
    case 'levels':
      return control.supportsOff ? ['off', ...control.levels] : [...control.levels];
    case 'unknown':
    case 'none':
    default:
      return ['off'];
  }
}

export function resolveOnSelection(control: ReasoningControl): ReasoningSelection {
  if (control.kind === 'always-on') {
    return control.lockedSelection ?? 'on';
  }
  if (control.kind === 'levels') {
    return control.defaultSelection === 'off'
      ? control.levels[0] ?? 'off'
      : control.defaultSelection;
  }
  return 'on';
}

// =====================================================================
// HAL Reasoning Level Mapping (user-facing 6-level system)
// =====================================================================

/** HAL reasoning level names (user-facing 6-level system). */
export type HalReasoningLevel = 'off' | 'low' | 'medium' | 'high' | 'extra' | 'max';

export const HAL_REASONING_LEVELS: readonly HalReasoningLevel[] = [
  'off',
  'low',
  'medium',
  'high',
  'extra',
  'max',
];

/** Map canonical wire name → HAL display name. */
export function halReasoningLevelFromCanonical(
  level: NamedReasoningLevel | 'off',
): HalReasoningLevel {
  if (level === 'off') return 'off';
  if (level === 'minimal') return 'low';
  if (level === 'xhigh') return 'extra';
  return level; // low, medium, high, max are same
}

/** Map HAL display name → canonical wire name. */
export function canonicalFromHalReasoningLevel(
  level: HalReasoningLevel,
): NamedReasoningLevel | 'off' {
  if (level === 'off') return 'off';
  if (level === 'low') return 'minimal';
  if (level === 'extra') return 'xhigh';
  return level; // medium, high, max are same
}

/** Get supported reasoning levels for a model based on its ReasoningControl. */
export function getSupportedReasoningLevels(
  control: ReasoningControl,
): HalReasoningLevel[] {
  if (control.kind === 'none' || control.kind === 'unknown') return [];
  if (control.kind === 'toggle') return ['off', 'low'];
  if (control.kind === 'always-on') {
    const locked = control.lockedSelection;
    if (locked && locked !== 'off' && locked !== 'on' && isNamedReasoningLevel(locked)) {
      return [halReasoningLevelFromCanonical(locked)];
    }
    return ['low'];
  }
  // kind === 'levels'
  if (control.levels.length === 0) {
    return control.supportsOff ? ['off'] : [];
  }
  const halLevels = control.levels.map(halReasoningLevelFromCanonical);
  return control.supportsOff ? ['off', ...halLevels] : [...halLevels];
}

/** Clamp a requested HAL level to the nearest supported level. */
export function clampReasoningLevel(
  control: ReasoningControl,
  requested: HalReasoningLevel,
): HalReasoningLevel {
  const supported = getSupportedReasoningLevels(control);
  if (supported.length === 0) return 'off';
  if (supported.includes(requested)) return requested;
  // Find nearest lower supported level
  const reqIdx = HAL_REASONING_LEVELS.indexOf(requested);
  for (let i = reqIdx - 1; i >= 0; i--) {
    if (supported.includes(HAL_REASONING_LEVELS[i])) return HAL_REASONING_LEVELS[i];
  }
  return supported[0];
}

export function clampReasoningSelection(
  reasoningSelection: unknown,
  control: ReasoningControl | null | undefined,
): ReasoningSelection | undefined {
  if (!control || !isReasoningSelection(reasoningSelection)) {
    return undefined;
  }

  const supported = getReasoningSelectionOrder(control);
  if (supported.includes(reasoningSelection)) {
    return reasoningSelection;
  }

  if (reasoningSelection === 'on') {
    return resolveOnSelection(control);
  }

  if (control.kind === 'toggle') {
    return reasoningSelection === 'off' ? 'off' : 'on';
  }

  if (control.kind === 'always-on') {
    return control.lockedSelection ?? 'on';
  }

  if (control.kind !== 'levels' || control.levels.length === 0) {
    return supported[0] ?? 'off';
  }

  if (reasoningSelection === 'off') {
    return control.supportsOff ? 'off' : control.levels[0];
  }

  const selectionIndex = NAMED_REASONING_LEVELS.indexOf(reasoningSelection);
  let best = control.levels[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const level of control.levels) {
    const distance = Math.abs(NAMED_REASONING_LEVELS.indexOf(level) - selectionIndex);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = level;
    }
  }
  return best;
}
