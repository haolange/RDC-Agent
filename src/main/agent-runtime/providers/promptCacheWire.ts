import type { Context } from '../core/types';
import type { ProviderCacheContract } from '@shared/provider-catalog/modelManifestSchema';

export interface PartitionedSystemPrompt {
  combinedText?: string;
  stableText?: string;
  volatileText?: string;
}

// =====================================================================
// Cache retention abstraction
// =====================================================================

/** High-level cache retention tier derived from the provider cache contract TTL. */
export type CacheRetention = 'none' | 'short' | 'long';

/** Anthropic-specific cache_control wire payload. */
export interface AnthropicCacheControlWire {
  type: 'ephemeral';
  ttl?: '5m' | '1h';
}

/** OpenAI-specific prompt cache wire fields. */
export interface OpenAICacheWire {
  promptCacheKey?: string;
  promptCacheRetention?: '24h';
}

/**
 * Derives the high-level cache retention tier from the contract TTL.
 * - 'none' → no cache markers should be emitted
 * - 'short' → standard ephemeral cache (Anthropic 5m / OpenAI default)
 * - 'long' → long-lived cache (Anthropic 1h TTL / OpenAI 24h retention)
 */
export function resolveCacheRetention(ttl: ProviderCacheContract['ttl']): CacheRetention {
  switch (ttl) {
    case 'none':
      return 'none';
    case 'one-hour':
    case 'twenty-four-hours':
      return 'long';
    default:
      // five-minutes, thirty-minutes, provider-managed, unknown
      return 'short';
  }
}

/**
 * Produces the Anthropic cache_control wire payload for the given retention.
 * - 'none' → undefined (no cache marker)
 * - 'short' → `{ type: 'ephemeral' }` (default 5m TTL)
 * - 'long' → `{ type: 'ephemeral', ttl: '1h' }`
 */
export function anthropicCacheControlForRetention(
  retention: CacheRetention,
): AnthropicCacheControlWire | undefined {
  switch (retention) {
    case 'none':
      return undefined;
    case 'long':
      return { type: 'ephemeral', ttl: '1h' };
    case 'short':
      return { type: 'ephemeral' };
  }
}

/**
 * Produces OpenAI prompt cache wire fields for the given retention.
 * - 'none' → empty (no cache fields)
 * - 'short' → prompt_cache_key only (standard implicit caching)
 * - 'long' → prompt_cache_key + prompt_cache_retention: '24h'
 */
export function openAICacheWireForRetention(
  retention: CacheRetention,
  requestKey?: string,
): OpenAICacheWire {
  if (retention === 'none') return {};
  return {
    ...(requestKey ? { promptCacheKey: requestKey } : {}),
    ...(retention === 'long' ? { promptCacheRetention: '24h' as const } : {}),
  };
}

/**
 * Converts PromptPlan segment ownership into physical provider blocks.
 * The split is fail-closed: the runtime prompt must be the exact segment
 * composition and stable segments must form one contiguous prefix.
 */
export function partitionSystemPrompt(
  context: Pick<Context, 'systemPrompt' | 'systemPromptSegments'>,
): PartitionedSystemPrompt {
  const combinedText = context.systemPrompt?.trim();
  if (!combinedText) return {};

  const segments = context.systemPromptSegments;
  if (!segments || segments.length === 0) return { combinedText };

  const normalized = segments
    .map((segment) => ({ ...segment, content: segment.content.trim() }))
    .filter((segment) => segment.content.length > 0);
  const composed = normalized.map((segment) => segment.content).join('\n\n');
  if (composed !== combinedText) {
    throw new Error(
      'PROMPT_PLAN_CONTEXT_MISMATCH: runtime system prompt differs from its compiled PromptPlan segments.',
    );
  }

  const firstVolatileIndex = normalized.findIndex((segment) => segment.stability === 'volatile');
  const stableCount = firstVolatileIndex < 0 ? normalized.length : firstVolatileIndex;
  if (normalized.slice(stableCount).some((segment) => segment.stability === 'stable')) {
    throw new Error(
      'PROMPT_PLAN_STABILITY_ORDER_INVALID: stable prompt segments must form one contiguous prefix.',
    );
  }

  const stable = normalized.slice(0, stableCount).map((segment) => segment.content).join('\n\n');
  const volatile = normalized.slice(stableCount).map((segment) => segment.content).join('\n\n');
  if (!stable) {
    return { combinedText, volatileText: volatile || undefined };
  }
  if (!volatile) {
    return { combinedText, stableText: stable };
  }

  // Content blocks do not insert separators. Keep the separator in the stable
  // block so stableText + volatileText is byte-for-byte equal to combinedText.
  return {
    combinedText,
    stableText: stable + '\n\n',
    volatileText: volatile,
  };
}
