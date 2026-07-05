import { lookupManagedModelCapabilityProfile } from '@shared/constants/modelCapabilityCatalog';
import type {
  ConversationTurnControls,
  EffortLevel,
  ModelCapabilityProfile,
  ReasoningLevel,
  ReasoningMode,
  ResolvedModelCapability,
} from '@shared/types/modelCapability';
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  MAX_CONTEXT_MODE_MIN_TOKENS,
  REASONING_LEVELS,
  clampReasoningLevel,
  isEffortReasoningLevel,
  isReasoningLevel,
} from '@shared/types/modelCapability';
import type { AppSettings, LlmProviderEntry } from '@shared/types/settings';

function sanitizeReasoningLevels(levels: ReasoningLevel[] | undefined): ReasoningLevel[] {
  if (!levels || levels.length === 0) {
    return ['off'];
  }
  return levels.filter((level) => (REASONING_LEVELS as readonly string[]).includes(level));
}

type TurnControlsInput = Partial<Omit<ConversationTurnControls, 'reasoningLevel'>> & {
  reasoningLevel?: unknown;
  effort?: unknown;
};

function normalizeTurnControls(
  controls: TurnControlsInput | undefined,
  defaultReasoningLevel: ReasoningLevel,
): ConversationTurnControls {
  const candidate = controls?.reasoningLevel ?? controls?.effort;
  return {
    reasoningLevel: isReasoningLevel(candidate) ? candidate : defaultReasoningLevel,
    maxContextMode: controls?.maxContextMode === true,
    fastModel: controls?.fastModel === true,
  };
}

function pickReasoningMode(profile: ModelCapabilityProfile | null, levels: ReasoningLevel[]): ReasoningMode {
  if (profile?.reasoningMode) {
    return profile.reasoningMode;
  }
  if (levels.some(isEffortReasoningLevel)) {
    return 'effort-levels';
  }
  if (levels.includes('auto')) {
    return 'auto-only';
  }
  return 'none';
}

function pickDefaultReasoningLevel(levels: ReasoningLevel[], profileDefault?: ReasoningLevel): ReasoningLevel {
  if (profileDefault && levels.includes(profileDefault)) {
    return profileDefault;
  }
  if (levels.includes('medium')) {
    return 'medium';
  }
  if (levels.includes('auto')) {
    return 'auto';
  }
  return levels[0] ?? 'off';
}

function resolveNominalContextWindow(profile: ModelCapabilityProfile | null): number | null {
  const value = profile?.nominalContextWindowTokens;
  return typeof value === 'number' && value > 0 ? value : null;
}

function isFastVariantAvailable(
  provider: LlmProviderEntry | undefined,
  fastVariantModelId: string | null,
): boolean {
  if (!fastVariantModelId || !provider) {
    return false;
  }
  return provider.models.some((model) => model.id === fastVariantModelId && model.enabled !== false);
}

export function resolveModelCapability(
  providerId: string,
  modelId: string,
  settings: AppSettings,
): ResolvedModelCapability {
  const provider = settings.llm.providers.find((entry) => entry.id === providerId);
  const profile = provider?.catalogOwnership === 'app-managed'
    ? lookupManagedModelCapabilityProfile(providerId, modelId)
    : null;

  const nominalContextWindowTokens = resolveNominalContextWindow(profile);
  const defaultContextWindowTokens = nominalContextWindowTokens !== null
    ? Math.min(DEFAULT_CONTEXT_WINDOW_TOKENS, nominalContextWindowTokens)
    : DEFAULT_CONTEXT_WINDOW_TOKENS;
  const maxContextWindowTokens = nominalContextWindowTokens !== null
    && nominalContextWindowTokens >= MAX_CONTEXT_MODE_MIN_TOKENS
    ? nominalContextWindowTokens
    : null;
  const maxContextAvailable = maxContextWindowTokens !== null;

  const supportedReasoningLevels = sanitizeReasoningLevels(profile?.supportedReasoningLevels);
  const reasoningMode = pickReasoningMode(profile, supportedReasoningLevels);
  const defaultReasoningLevel = pickDefaultReasoningLevel(supportedReasoningLevels, profile?.defaultReasoningLevel);
  const fastVariantModelId = profile?.fastVariantModelId ?? null;

  return {
    providerId,
    modelId,
    catalogSource: profile ? 'managed-catalog' : 'conservative-default',
    nominalContextWindowTokens,
    defaultContextWindowTokens,
    maxContextWindowTokens,
    reasoningMode,
    supportedReasoningLevels,
    defaultReasoningLevel,
    maxContextAvailable,
    fastVariantModelId,
    fastModelAvailable: isFastVariantAvailable(provider, fastVariantModelId),
    toolCalling: Boolean(profile?.toolCalling),
    visionInput: Boolean(profile?.visionInput),
    structuredOutput: Boolean(profile?.structuredOutput),
  };
}

export function resolveTurnControls(
  capability: ResolvedModelCapability,
  requestControls?: TurnControlsInput,
  sessionControls?: TurnControlsInput,
): ConversationTurnControls {
  if (requestControls) {
    return normalizeTurnControls(requestControls, capability.defaultReasoningLevel);
  }
  if (sessionControls) {
    return normalizeTurnControls(sessionControls, capability.defaultReasoningLevel);
  }
  return {
    reasoningLevel: capability.defaultReasoningLevel,
    maxContextMode: false,
    fastModel: false,
  };
}

export function resolveEffectiveModelId(
  capability: ResolvedModelCapability,
  turnControls: ConversationTurnControls,
): string {
  if (turnControls.fastModel && capability.fastModelAvailable && capability.fastVariantModelId) {
    return capability.fastVariantModelId;
  }
  return capability.modelId;
}

export function resolveReasoningBudget(
  capability: ResolvedModelCapability,
  turnControls: TurnControlsInput,
): EffortLevel | 'auto' | 'off' {
  if (capability.reasoningMode === 'none') {
    return 'off';
  }
  const normalized = normalizeTurnControls(turnControls, capability.defaultReasoningLevel);
  const clamped = clampReasoningLevel(normalized.reasoningLevel, capability.supportedReasoningLevels)
    ?? capability.defaultReasoningLevel;
  if (clamped === 'off' || clamped === 'auto') {
    return clamped;
  }
  return clamped;
}
