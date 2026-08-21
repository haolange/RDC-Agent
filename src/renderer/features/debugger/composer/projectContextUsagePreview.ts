import type { RunContextUsageSummary } from '@shared/types/session';
import type { ConversationPreparationPhase } from '../../../stores/contextUsageProjectionModel';
import type { SelectedContextProfile } from './selectedContextProfile';

export interface ContextUsagePreview {
  usage: RunContextUsageSummary | null;
  estimated: boolean;
}

const PREVIEW_PHASES: ReadonlySet<ConversationPreparationPhase> = new Set(['idle', 'actual', 'preparing']);

export function shouldProjectContextUsagePreview(
  usage: RunContextUsageSummary,
  profile: SelectedContextProfile,
): boolean {
  return usage.providerId !== profile.providerId
    || usage.modelId !== profile.modelId
    || usage.promptBudgetTokens !== profile.contextBudgetTokens
    || usage.compactionThresholdTokens !== profile.compactionThresholdTokens;
}

function rescaleBreakdown(
  breakdown: RunContextUsageSummary['breakdown'],
  occupiedTokens: number,
  denom: number,
): RunContextUsageSummary['breakdown'] {
  if (breakdown === null) return null;
  const freeTokens = Math.max(0, denom - occupiedTokens);
  const next = breakdown.map((entry) => (
    entry.id === 'free' ? { ...entry, tokens: freeTokens } : entry
  ));
  if (!next.some((entry) => entry.id === 'free')) {
    next.push({ id: 'free', tokens: freeTokens });
  }
  return next;
}

export function projectContextUsagePreview(
  usage: RunContextUsageSummary | null,
  profile: SelectedContextProfile | null,
  phase: ConversationPreparationPhase,
): ContextUsagePreview {
  if (!usage || !profile || !PREVIEW_PHASES.has(phase)) {
    return { usage, estimated: false };
  }
  if (!shouldProjectContextUsagePreview(usage, profile)) {
    return { usage, estimated: false };
  }

  const denom = profile.contextBudgetTokens;
  const occupiedTokens = usage.occupiedTokens;
  const usagePercent = denom > 0
    ? Math.min(100, Math.max(0, Math.round((occupiedTokens / denom) * 100)))
    : 0;

  return {
    estimated: true,
    usage: {
      ...usage,
      promptBudgetTokens: denom,
      contextWindowTokens: profile.contextWindowTokens,
      maxOutputTokens: profile.maxOutputTokens,
      compactionThresholdTokens: profile.compactionThresholdTokens,
      usagePercent,
      breakdown: rescaleBreakdown(usage.breakdown, occupiedTokens, denom),
    },
  };
}
