import { lookupManagedModelCapabilityProfile } from '@shared/constants/modelCapabilityCatalog';
import type {
  ConversationTurnControls,
  ModelCapabilityProfile,
  ReasoningControl,
  ResolvedModelCapability,
  ResolvedReasoningSelection,
} from '@shared/types/modelCapability';
import {
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  MAX_CONTEXT_MODE_MIN_TOKENS,
  clampReasoningSelection,
  coerceReasoningSelectionCandidate,
  createReasoningControl,
} from '@shared/types/modelCapability';
import type { AppSettings, LlmProviderEntry } from '@shared/types/settings';

const CONSERVATIVE_REASONING_CONTROL: ReasoningControl = {
  kind: 'none',
  supportsOff: true,
  levels: [],
  defaultSelection: 'off',
  wireProfile: { kind: 'none' },
};

function sanitizeReasoningControl(control: ReasoningControl | undefined): ReasoningControl {
  return createReasoningControl(control ?? CONSERVATIVE_REASONING_CONTROL);
}

type TurnControlsInput = Partial<Omit<ConversationTurnControls, 'reasoningLevel'>> & {
  reasoningLevel?: unknown;
};

function normalizeTurnControls(
  controls: TurnControlsInput | undefined,
  reasoningControl: ReasoningControl,
): ConversationTurnControls {
  const candidate = controls?.reasoningLevel;
  const reasoningLevel = coerceReasoningSelectionCandidate(candidate, reasoningControl)
    ?? reasoningControl.defaultSelection;
  return {
    reasoningLevel,
    maxContextMode: controls?.maxContextMode === true,
    fastModel: controls?.fastModel === true,
  };
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
  const reasoningControl = sanitizeReasoningControl(profile?.reasoningControl);
  const fastVariantModelId = profile?.fastVariantModelId ?? null;

  return {
    providerId,
    modelId,
    catalogSource: profile ? 'managed-catalog' : 'conservative-default',
    nominalContextWindowTokens,
    defaultContextWindowTokens,
    maxContextWindowTokens,
    reasoningControl,
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
    return normalizeTurnControls(requestControls, capability.reasoningControl);
  }
  if (sessionControls) {
    return normalizeTurnControls(sessionControls, capability.reasoningControl);
  }
  return {
    reasoningLevel: capability.reasoningControl.defaultSelection,
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

export function resolveReasoningSelection(
  capability: ResolvedModelCapability,
  turnControls: TurnControlsInput,
): ResolvedReasoningSelection {
  const normalized = normalizeTurnControls(turnControls, capability.reasoningControl);
  const selection = clampReasoningSelection(normalized.reasoningLevel, capability.reasoningControl)
    ?? capability.reasoningControl.defaultSelection;
  return {
    selection,
    control: capability.reasoningControl,
  };
}
