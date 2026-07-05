export type EffortLevel = 'low' | 'medium' | 'high' | 'extHigh' | 'max';
export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'extHigh', 'max'];

export type ReasoningLevel = 'off' | 'auto' | EffortLevel;
export const REASONING_LEVELS: readonly ReasoningLevel[] = ['off', 'auto', 'low', 'medium', 'high', 'extHigh', 'max'];
export type ReasoningMode = 'none' | 'auto-only' | 'effort-levels';

export interface ConversationTurnControls {
  reasoningLevel: ReasoningLevel;
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
  reasoningMode?: ReasoningMode;
  supportedReasoningLevels?: ReasoningLevel[];
  defaultReasoningLevel?: ReasoningLevel;
  fastVariantModelId?: string;
  toolCalling?: boolean;
  visionInput?: boolean;
  structuredOutput?: boolean;
}

export interface ResolvedModelCapability {
  providerId: string;
  modelId: string;
  catalogSource: 'managed-catalog' | 'conservative-default';
  nominalContextWindowTokens: number | null;
  defaultContextWindowTokens: number;
  maxContextWindowTokens: number | null;
  reasoningMode: ReasoningMode;
  supportedReasoningLevels: ReasoningLevel[];
  defaultReasoningLevel: ReasoningLevel;
  maxContextAvailable: boolean;
  fastVariantModelId: string | null;
  fastModelAvailable: boolean;
  toolCalling: boolean;
  visionInput: boolean;
  structuredOutput: boolean;
}

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 256_000;
export const MAX_CONTEXT_MODE_MIN_TOKENS = 1_000_000;
export const CONTEXT_COMPACTION_RATIO = 0.8;

export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return typeof value === 'string' && (REASONING_LEVELS as readonly string[]).includes(value);
}

export function clampReasoningLevel(
  reasoningLevel: unknown,
  supported: readonly ReasoningLevel[] | null | undefined,
): ReasoningLevel | undefined {
  if (!Array.isArray(supported) || supported.length === 0) {
    return undefined;
  }
  if (!isReasoningLevel(reasoningLevel)) {
    return undefined;
  }
  if (supported.includes(reasoningLevel)) {
    return reasoningLevel;
  }
  const reasoningIndex = REASONING_LEVELS.indexOf(reasoningLevel);
  let best = supported[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const level of supported) {
    const distance = Math.abs(REASONING_LEVELS.indexOf(level) - reasoningIndex);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = level;
    }
  }
  return best;
}

export function isEffortReasoningLevel(level: ReasoningLevel): level is EffortLevel {
  return (EFFORT_LEVELS as readonly ReasoningLevel[]).includes(level);
}

export function resolveActiveContextWindowTokens(
  capability: Pick<ResolvedModelCapability, 'defaultContextWindowTokens' | 'maxContextAvailable' | 'maxContextWindowTokens'>,
  turnControls: Pick<ConversationTurnControls, 'maxContextMode'>,
): number {
  if (
    turnControls.maxContextMode
    && capability.maxContextAvailable
    && capability.maxContextWindowTokens !== null
  ) {
    return capability.maxContextWindowTokens;
  }
  return capability.defaultContextWindowTokens;
}
