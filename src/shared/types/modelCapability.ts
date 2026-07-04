export type EffortLevel = 'low' | 'medium' | 'high' | 'extra' | 'max';
export const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'extra', 'max'];

export interface ConversationTurnControls {
  effort: EffortLevel;
  maxContextMode: boolean;
  fastModel: boolean;
}

/** seed/override 声明形态 */
export interface ModelCapabilityProfile {
  nominalContextWindowTokens?: number;
  supportedEffortLevels?: EffortLevel[];
  fastVariantModelId?: string;
}

/** 主进程 resolve 后给 renderer 的完整视图 */
export interface ResolvedModelCapability {
  providerId: string;
  modelId: string;
  nominalContextWindowTokens: number | null;
  defaultContextWindowTokens: number;
  maxContextWindowTokens: number | null;
  supportedEffortLevels: EffortLevel[];
  defaultEffort: EffortLevel;
  maxContextAvailable: boolean;
  fastVariantModelId: string | null;
  fastModelAvailable: boolean;
}

export const DEFAULT_CONTEXT_WINDOW_TOKENS = 256_000;
export const CONTEXT_COMPACTION_RATIO = 0.8;

export function clampEffortLevel(
  effort: EffortLevel,
  supported: EffortLevel[],
): EffortLevel | undefined {
  if (supported.length === 0) {
    return undefined;
  }
  if (supported.includes(effort)) {
    return effort;
  }
  const effortIndex = EFFORT_LEVELS.indexOf(effort);
  let best = supported[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const level of supported) {
    const distance = Math.abs(EFFORT_LEVELS.indexOf(level) - effortIndex);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = level;
    }
  }
  return best;
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
