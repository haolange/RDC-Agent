import { lookupModelCapabilitySeed } from '@shared/constants/modelCapabilityCatalog';
import type {
  ConversationTurnControls,
  EffortLevel,
  ModelCapabilityProfile,
  ResolvedModelCapability,
} from '@shared/types/modelCapability';
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  EFFORT_LEVELS,
  clampEffortLevel,
} from '@shared/types/modelCapability';
import type { AppSettings, LlmProviderCapability, LlmProviderEntry } from '@shared/types/settings';

const DEFAULT_REASONING_EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high'];

function hasProviderCapability(
  provider: LlmProviderEntry | undefined,
  capability: LlmProviderCapability,
): boolean {
  return Boolean(provider?.capabilities?.includes(capability));
}

function sanitizeEffortLevels(levels: EffortLevel[] | undefined): EffortLevel[] {
  if (!levels || levels.length === 0) {
    return [];
  }
  return levels.filter((level) => (EFFORT_LEVELS as readonly string[]).includes(level));
}

function pickDefaultEffort(levels: EffortLevel[]): EffortLevel {
  if (levels.includes('medium')) {
    return 'medium';
  }
  if (levels.length === 0) {
    return 'medium';
  }
  return levels[Math.floor(levels.length / 2)];
}

function mergeProfileField<T>(
  override: T | undefined,
  seed: T | undefined,
  fallback: T,
): T {
  if (override !== undefined) {
    return override;
  }
  if (seed !== undefined) {
    return seed;
  }
  return fallback;
}

function resolveNominalContextWindow(
  override: ModelCapabilityProfile | undefined,
  seed: ModelCapabilityProfile | null,
): number | null {
  const overrideValue = override?.nominalContextWindowTokens;
  if (typeof overrideValue === 'number' && overrideValue > 0) {
    return overrideValue;
  }
  const seedValue = seed?.nominalContextWindowTokens;
  if (typeof seedValue === 'number' && seedValue > 0) {
    return seedValue;
  }
  return null;
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
  const model = provider?.models.find((entry) => entry.id === modelId);
  const override = model?.capabilityOverride;
  const seed = lookupModelCapabilitySeed(modelId);

  const nominalContextWindowTokens = resolveNominalContextWindow(override, seed);
  const defaultContextWindowTokens = nominalContextWindowTokens !== null
    ? Math.min(DEFAULT_CONTEXT_WINDOW_TOKENS, nominalContextWindowTokens)
    : DEFAULT_CONTEXT_WINDOW_TOKENS;
  const maxContextWindowTokens = nominalContextWindowTokens !== null
    && nominalContextWindowTokens > DEFAULT_CONTEXT_WINDOW_TOKENS
    ? nominalContextWindowTokens
    : null;
  const maxContextAvailable = maxContextWindowTokens !== null;

  const defaultEffortLevels = hasProviderCapability(provider, 'reasoning')
    ? DEFAULT_REASONING_EFFORT_LEVELS
    : [];
  const mergedEffortLevels = sanitizeEffortLevels(
    mergeProfileField(
      override?.supportedEffortLevels,
      seed?.supportedEffortLevels,
      defaultEffortLevels,
    ),
  );
  const supportedEffortLevels = hasProviderCapability(provider, 'reasoning')
    ? mergedEffortLevels
    : [];

  const fastVariantModelId = mergeProfileField(
    override?.fastVariantModelId,
    seed?.fastVariantModelId,
    undefined as string | undefined,
  ) ?? null;

  return {
    providerId,
    modelId,
    nominalContextWindowTokens,
    defaultContextWindowTokens,
    maxContextWindowTokens,
    supportedEffortLevels,
    defaultEffort: pickDefaultEffort(supportedEffortLevels),
    maxContextAvailable,
    fastVariantModelId,
    fastModelAvailable: isFastVariantAvailable(provider, fastVariantModelId),
  };
}

export function resolveTurnControls(
  capability: ResolvedModelCapability,
  requestControls?: ConversationTurnControls,
  sessionControls?: ConversationTurnControls,
): ConversationTurnControls {
  if (requestControls) {
    return requestControls;
  }
  if (sessionControls) {
    return sessionControls;
  }
  return {
    effort: capability.defaultEffort,
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
  turnControls: ConversationTurnControls,
): EffortLevel | 'auto' {
  if (capability.supportedEffortLevels.length === 0) {
    return 'auto';
  }
  const clamped = clampEffortLevel(turnControls.effort, capability.supportedEffortLevels);
  return clamped ?? capability.defaultEffort;
}
