import type { PreparedTurnContextSummary, RunContextUsageSummary } from '@shared/types/session';
import { DEFAULT_CONTEXT_COMPACTION_PERCENT } from '@shared/types/modelCapability';
import {
  resolveCompactionThresholdTokens,
  resolveTurnOutputTokens,
} from '@shared/utils/contextBudget';

export interface ContextUsageSelectedProfile {
  contextWindowTokens: number;
  contextBudgetTokens: number;
  maxOutputTokens: number;
  compactionThresholdTokens: number;
}

function positiveOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
}

export function resolveDisplayedPromptBudget(
  showPrepared: boolean,
  prepared: PreparedTurnContextSummary | null,
  usage: RunContextUsageSummary | null,
  profile: ContextUsageSelectedProfile | null,
): number | null {
  if (showPrepared && prepared) return prepared.promptBudgetTokens;
  return positiveOrNull(usage?.promptBudgetTokens) ?? positiveOrNull(profile?.contextBudgetTokens);
}

export function resolveDisplayedContextWindow(
  showPrepared: boolean,
  prepared: PreparedTurnContextSummary | null,
  usage: RunContextUsageSummary | null,
  profile: ContextUsageSelectedProfile | null,
): number | null {
  if (showPrepared && prepared) return prepared.contextWindowTokens;
  return positiveOrNull(usage?.contextWindowTokens) ?? positiveOrNull(profile?.contextWindowTokens);
}

export function resolveDisplayedMaxOutput(
  showPrepared: boolean,
  prepared: PreparedTurnContextSummary | null,
  usage: RunContextUsageSummary | null,
  profile: ContextUsageSelectedProfile | null,
): number | null {
  if (showPrepared && prepared) return prepared.maxOutputTokens;
  if (typeof usage?.maxOutputTokens === 'number') return usage.maxOutputTokens;
  return profile ? profile.maxOutputTokens : null;
}

export function resolveDisplayedCompactionThreshold(
  showPrepared: boolean,
  prepared: PreparedTurnContextSummary | null,
  usage: RunContextUsageSummary | null,
  profile: ContextUsageSelectedProfile | null,
): number | null {
  if (showPrepared && prepared) return prepared.compactionThresholdTokens;
  if (profile) return profile.compactionThresholdTokens;
  if (typeof usage?.compactionThresholdTokens === 'number' && usage.compactionThresholdTokens > 0) {
    return usage.compactionThresholdTokens;
  }
  const budget = resolveDisplayedPromptBudget(showPrepared, prepared, usage, profile);
  if (budget) return resolveCompactionThresholdTokens(budget, DEFAULT_CONTEXT_COMPACTION_PERCENT);
  return null;
}

export function resolveDisplayedGeneratable(
  showPrepared: boolean,
  prepared: PreparedTurnContextSummary | null,
  usage: RunContextUsageSummary | null,
  profile: ContextUsageSelectedProfile | null,
): number | null {
  const windowTokens = resolveDisplayedContextWindow(showPrepared, prepared, usage, profile);
  const maxOutput = resolveDisplayedMaxOutput(showPrepared, prepared, usage, profile);
  const occupied = showPrepared && prepared
    ? prepared.preparedInputTokens
    : usage?.occupiedTokens ?? 0;
  if (windowTokens == null || maxOutput == null) return null;
  return resolveTurnOutputTokens({
    contextWindowTokens: windowTokens,
    maxOutputTokens: maxOutput,
    promptTokens: occupied,
  });
}
