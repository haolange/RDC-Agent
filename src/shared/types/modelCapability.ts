export type NamedReasoningLevel = 'minimal' | 'low' | 'medium' | 'high' | 'extra' | 'max' | 'ultra';
export const NAMED_REASONING_LEVELS: readonly NamedReasoningLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'extra',
  'max',
  'ultra',
];

export type ReasoningSelection = 'off' | 'on' | NamedReasoningLevel;
export const REASONING_SELECTIONS: readonly ReasoningSelection[] = [
  'off',
  'on',
  ...NAMED_REASONING_LEVELS,
];

export type ReasoningControlKind = 'none' | 'toggle' | 'levels' | 'always-on';

export type OpenAiWireEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
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
      onMode?: 'enable-thinking-true' | 'thinking-enabled';
      offMode?: 'reasoning-none' | 'enable-thinking-false' | 'thinking-disabled';
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
  defaultSelection: ReasoningSelection;
  lockedSelection?: ReasoningSelection;
  wireProfile: ReasoningWireProfile;
}

export interface ConversationTurnControls {
  reasoningLevel: ReasoningSelection;
  maxContextMode: boolean;
  fastModel: boolean;
}

export type ModelCapabilitySourceKind = 'official' | 'observed' | 'conservative';

export interface ModelCapabilitySource {
  kind: ModelCapabilitySourceKind;
  updatedAt: string;
  urls: string[];
  note?: string;
}

export interface ModelCapabilityProfile {
  nominalContextWindowTokens?: number;
  reasoningControl?: ReasoningControl;
  fast?: { modelId: string };
  /** When set, provider requests must use this temperature (e.g. kimi-for-coding allows only 1). */
  fixedTemperature?: number;
  toolCalling?: boolean;
  visionInput?: boolean;
  structuredOutput?: boolean;
}

export interface ResolvedReasoningSelection {
  selection: ReasoningSelection;
  control: ReasoningControl;
}

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 256_000;
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

export function coerceReasoningSelectionCandidate(
  value: unknown,
  control: ReasoningControl | null | undefined,
): ReasoningSelection | undefined {
  if (value === 'auto') {
    return control ? resolveOnSelection(control) : undefined;
  }
  if (value === 'extHigh') {
    return 'extra';
  }
  return clampReasoningSelection(value, control);
}
