import type { Context } from '../core/types';
import type { CompiledPromptCache } from '@shared/types/semanticContext';

/** Request headers a cache contract carries; the session-affine carrier routes by the session-id header. */
export function promptCacheHeaders(cache: CompiledPromptCache | undefined): Record<string, string> {
  return cache?.enabled && cache.keyCarrier === 'session-id-and-prompt-cache-key' && cache.requestKey
    ? { 'session-id': cache.requestKey }
    : {};
}

export interface PartitionedSystemPrompt {
  combinedText?: string;
  stableText?: string;
  volatileText?: string;
}

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
