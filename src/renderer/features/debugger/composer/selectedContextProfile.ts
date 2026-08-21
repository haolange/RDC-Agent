import type { ConversationTurnControls } from '@shared/types/modelCapability';
import { DEFAULT_CONTEXT_COMPACTION_PERCENT } from '@shared/types/modelCapability';
import type { EffectiveModel } from '@shared/types/providerCapability';
import {
  contextTierBudgetTokens,
  contextTierWindowTokens,
  ONE_MILLION_CONTEXT_TOKENS,
  resolveContextTierChoices,
} from '@shared/utils/contextTiers';
import { resolveCompactionThresholdTokens } from '@shared/utils/contextBudget';
import { resolveModelControls } from '@shared/utils/modelControls';

export interface SelectedContextProfile {
  providerId: string;
  modelId: string;
  contextWindowTokens: number;
  contextBudgetTokens: number;
  maxOutputTokens: number;
  compactionThresholdTokens: number;
}

export function resolveSelectedContextProfile(
  model: EffectiveModel,
  controls: ConversationTurnControls,
  compactionThresholdPercent: number = DEFAULT_CONTEXT_COMPACTION_PERCENT,
): SelectedContextProfile | null {
  if (!Number.isFinite(model.defaultBudgetTokens) || model.defaultBudgetTokens <= 0) {
    return null;
  }

  const evaluation = resolveModelControls(model, controls);
  const choices = resolveContextTierChoices(model);
  const oneMillionMode = evaluation.resolved.context1m.value;
  const selectedTier = oneMillionMode ? choices.oneMillionTier : choices.normalTier;
  if (!selectedTier) return null;

  const requestedBudget = oneMillionMode
    ? ONE_MILLION_CONTEXT_TOKENS
    : model.defaultBudgetTokens;
  const contextBudgetTokens = contextTierBudgetTokens(selectedTier, requestedBudget);
  if (!Number.isFinite(contextBudgetTokens) || contextBudgetTokens <= 0) {
    return null;
  }

  const contextWindowTokens = contextTierWindowTokens(selectedTier) ?? contextBudgetTokens;
  const maxOutputTokens = selectedTier.maxOutputTokens ?? 0;
  return {
    providerId: model.providerId,
    modelId: model.modelId,
    contextWindowTokens,
    contextBudgetTokens,
    maxOutputTokens,
    compactionThresholdTokens: resolveCompactionThresholdTokens(
      contextBudgetTokens,
      compactionThresholdPercent,
    ),
  };
}
