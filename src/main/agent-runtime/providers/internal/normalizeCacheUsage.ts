/**
 * Cross-provider prompt-cache hit/miss normalization.
 *
 * Priority (aligned with DeepSeek-GUI / Kun):
 * 1. Native `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` when either is present
 * 2. Compat: hit = cacheReadTokens, miss = max(inputTokens - hit, 0)
 * 3. Fail-closed: no native fields and no cacheRead → omit hit/miss entirely
 *
 * Never treat cacheWrite as miss. Never invent rates in the renderer.
 */

export interface CacheUsageWireInput {
  inputTokens: number;
  /** DeepSeek-style native hit tokens (optional). */
  promptCacheHitTokens?: number;
  /** DeepSeek-style native miss tokens (optional). */
  promptCacheMissTokens?: number;
  /** OpenAI / Anthropic / Google cache-read tokens (optional). */
  cacheReadTokens?: number;
}

export interface NormalizedCacheHitMiss {
  cacheHitTokens?: number;
  cacheMissTokens?: number;
}

function isFiniteToken(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/** Resolve hit/miss from wire fields. Empty object means "no cache telemetry". */
export function normalizeCacheUsage(input: CacheUsageWireInput): NormalizedCacheHitMiss {
  const hasNativeHit = isFiniteToken(input.promptCacheHitTokens);
  const hasNativeMiss = isFiniteToken(input.promptCacheMissTokens);
  if (hasNativeHit || hasNativeMiss) {
    const hit = hasNativeHit ? input.promptCacheHitTokens! : 0;
    const miss = hasNativeMiss ? input.promptCacheMissTokens! : 0;
    // Match Kun: only lock the native path when at least one side is positive.
    // Both-zero falls through so compat cacheRead can still apply.
    if (hit > 0 || miss > 0) {
      return { cacheHitTokens: hit, cacheMissTokens: miss };
    }
  }

  if (isFiniteToken(input.cacheReadTokens)) {
    const hit = input.cacheReadTokens;
    return {
      cacheHitTokens: hit,
      cacheMissTokens: Math.max(input.inputTokens - hit, 0),
    };
  }

  return {};
}

export interface ProviderUsageDraft {
  inputTokens: number;
  outputTokens: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
  cost?: {
    input: number;
    output: number;
    total: number;
  };
}

/** Build a Usage object with normalized cacheHit/cacheMiss attached when available. */
export function finalizeProviderUsage(draft: ProviderUsageDraft): import('../../core/types').Usage {
  const {
    promptCacheHitTokens,
    promptCacheMissTokens,
    totalTokens,
    ...rest
  } = draft;
  const normalized = normalizeCacheUsage({
    inputTokens: draft.inputTokens,
    cacheReadTokens: draft.cacheReadTokens,
    promptCacheHitTokens,
    promptCacheMissTokens,
  });
  return {
    inputTokens: rest.inputTokens,
    outputTokens: rest.outputTokens,
    totalTokens: totalTokens ?? (rest.inputTokens + rest.outputTokens),
    ...(rest.cacheReadTokens !== undefined ? { cacheReadTokens: rest.cacheReadTokens } : {}),
    ...(rest.cacheWriteTokens !== undefined ? { cacheWriteTokens: rest.cacheWriteTokens } : {}),
    ...(rest.reasoningTokens !== undefined ? { reasoningTokens: rest.reasoningTokens } : {}),
    ...(rest.cost !== undefined ? { cost: rest.cost } : {}),
    ...normalized,
  };
}

/** Hit rate in 0–100 percent; omitted when denominator is zero. */
export function cacheHitRatePercent(hit: number, miss: number): number | undefined {
  const denom = hit + miss;
  if (denom <= 0) return undefined;
  return Math.min(100, Math.max(0, Math.round((hit / denom) * 100)));
}
