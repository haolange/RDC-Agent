import {
  CONTEXT_COMPACTION_PERCENT_MAX,
  CONTEXT_COMPACTION_PERCENT_MIN,
  CONTEXT_COMPACTION_PERCENT_STEP,
  DEFAULT_CONTEXT_COMPACTION_PERCENT,
  POLICY_UNLIMITED_COMPACTION_PERCENT,
} from '../types/modelCapability';

export function sanitizeCompactionThresholdPercent(
  value: unknown,
  fallback = DEFAULT_CONTEXT_COMPACTION_PERCENT,
): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  const clamped = Math.min(
    CONTEXT_COMPACTION_PERCENT_MAX,
    Math.max(CONTEXT_COMPACTION_PERCENT_MIN, numeric),
  );
  const stepped = Math.round(clamped / CONTEXT_COMPACTION_PERCENT_STEP) * CONTEXT_COMPACTION_PERCENT_STEP;
  return Math.min(
    CONTEXT_COMPACTION_PERCENT_MAX,
    Math.max(CONTEXT_COMPACTION_PERCENT_MIN, stepped),
  );
}

/**
 * Merge user compaction percent with policy. Policy values ≥ 100 mean unlimited
 * (do not constrain). The result never loosens past the user setting, and is
 * clamped to the product 50–90 / step-5 range.
 */
export function resolveEffectiveCompactionPercent(
  userPercent: number,
  policyPercent: number,
): number {
  const user = sanitizeCompactionThresholdPercent(userPercent);
  if (!Number.isFinite(policyPercent) || policyPercent >= POLICY_UNLIMITED_COMPACTION_PERCENT) {
    return user;
  }
  const tightened = Math.min(user, policyPercent);
  const steppedDown = Math.floor(tightened / CONTEXT_COMPACTION_PERCENT_STEP) * CONTEXT_COMPACTION_PERCENT_STEP;
  return Math.min(
    CONTEXT_COMPACTION_PERCENT_MAX,
    Math.max(CONTEXT_COMPACTION_PERCENT_MIN, steppedDown),
  );
}

export function resolveCompactionThresholdTokens(promptBudget: number, percent: number): number {
  if (!Number.isFinite(promptBudget) || promptBudget <= 0) return 0;
  const resolvedPercent = sanitizeCompactionThresholdPercent(percent);
  return Math.floor((promptBudget * resolvedPercent) / 100);
}

export function resolveTurnOutputTokens(input: {
  contextWindowTokens: number;
  maxOutputTokens: number;
  promptTokens: number;
}): number | null {
  const { contextWindowTokens, maxOutputTokens, promptTokens } = input;
  if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) return null;
  if (!Number.isFinite(maxOutputTokens) || maxOutputTokens <= 0) return null;
  const occupied = Number.isFinite(promptTokens) ? Math.max(0, promptTokens) : 0;
  const safety = Math.max(1024, Math.ceil(occupied * 0.02));
  const remaining = contextWindowTokens - occupied - safety;
  const resolved = Math.min(maxOutputTokens, remaining);
  if (!Number.isFinite(resolved) || resolved <= 0) return null;
  return Math.floor(resolved);
}
