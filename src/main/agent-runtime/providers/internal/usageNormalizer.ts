import { finalizeProviderUsage } from './normalizeCacheUsage';
import type { Usage } from '../../core/types';

type TokenCountReader<WireUsage> = (usage: WireUsage) => number | null | undefined;

/**
 * Where one wire family reports each usage figure in its own usage object. Only input and output are always
 * reported; a figure the wire does not report has no reader.
 */
export interface UsageFieldMap<WireUsage> {
  inputTokens: TokenCountReader<WireUsage>;
  outputTokens: TokenCountReader<WireUsage>;
  /** The wire's own total; without one the total is input plus output. */
  totalTokens?: TokenCountReader<WireUsage>;
  cacheReadTokens?: TokenCountReader<WireUsage>;
  cacheWriteTokens?: TokenCountReader<WireUsage>;
  reasoningTokens?: TokenCountReader<WireUsage>;
  /** DeepSeek-style native prompt-cache hit and miss counts. */
  promptCacheHitTokens?: TokenCountReader<WireUsage>;
  promptCacheMissTokens?: TokenCountReader<WireUsage>;
  speed?: (usage: WireUsage) => Usage['speed'];
}

type OptionalTokenCount =
  'cacheReadTokens' | 'cacheWriteTokens' | 'reasoningTokens' | 'promptCacheHitTokens' | 'promptCacheMissTokens';

const OPTIONAL_TOKEN_COUNTS: readonly OptionalTokenCount[] = [
  'cacheReadTokens',
  'cacheWriteTokens',
  'reasoningTokens',
  'promptCacheHitTokens',
  'promptCacheMissTokens',
];

/**
 * Reads one wire usage object through its field map into the runtime `Usage`. A missing input or output counts zero;
 * any other figure the wire leaves out stays absent, and prompt-cache hit and miss follow `finalizeProviderUsage`.
 */
export function normalizeUsage<WireUsage>(usage: WireUsage, fields: UsageFieldMap<WireUsage>): Usage {
  const inputTokens = fields.inputTokens(usage) ?? 0;
  const outputTokens = fields.outputTokens(usage) ?? 0;
  const optionalCounts: Partial<Record<OptionalTokenCount, number>> = {};
  for (const name of OPTIONAL_TOKEN_COUNTS) {
    const count = fields[name]?.(usage);
    if (typeof count === 'number') optionalCounts[name] = count;
  }
  const speed = fields.speed?.(usage);
  return finalizeProviderUsage({
    inputTokens,
    outputTokens,
    totalTokens: fields.totalTokens?.(usage) ?? inputTokens + outputTokens,
    ...optionalCounts,
    ...(speed !== undefined ? { speed } : {}),
  });
}
