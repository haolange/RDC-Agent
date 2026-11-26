import { describe, expect, it } from 'vitest';
import { normalizeUsage, type UsageFieldMap } from './usageNormalizer';

interface FixtureUsage {
  prompt?: number | null;
  completion?: number | null;
  total?: number | null;
  cached?: number | null;
  written?: number | null;
  thinking?: number | null;
  hits?: number | null;
  misses?: number | null;
  speed?: 'standard' | 'fast';
}

const FULL_FIELDS: UsageFieldMap<FixtureUsage> = {
  inputTokens: (usage) => usage.prompt,
  outputTokens: (usage) => usage.completion,
  totalTokens: (usage) => usage.total,
  cacheReadTokens: (usage) => usage.cached,
  cacheWriteTokens: (usage) => usage.written,
  reasoningTokens: (usage) => usage.thinking,
  promptCacheHitTokens: (usage) => usage.hits,
  promptCacheMissTokens: (usage) => usage.misses,
  speed: (usage) => usage.speed,
};

describe('normalizeUsage', () => {
  it('counts a missing input or output as zero, sums a missing total and leaves unreported figures absent', () => {
    expect(normalizeUsage({ completion: 7, cached: null }, FULL_FIELDS)).toEqual({
      inputTokens: 0,
      outputTokens: 7,
      totalTokens: 7,
    });
  });

  it('keeps the wire total and every reported figure, deriving cache hit and miss from the cache read', () => {
    expect(
      normalizeUsage(
        { prompt: 100, completion: 20, total: 125, cached: 60, written: 10, thinking: 5, speed: 'fast' },
        FULL_FIELDS,
      ),
    ).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 125,
      cacheReadTokens: 60,
      cacheWriteTokens: 10,
      reasoningTokens: 5,
      speed: 'fast',
      cacheHitTokens: 60,
      cacheMissTokens: 40,
    });
  });

  it('prefers native prompt-cache hit and miss counts over the cache read', () => {
    expect(normalizeUsage({ prompt: 100, completion: 1, cached: 60, hits: 30, misses: 70 }, FULL_FIELDS)).toMatchObject(
      {
        cacheReadTokens: 60,
        cacheHitTokens: 30,
        cacheMissTokens: 70,
      },
    );
  });

  it('reads only the figures a wire maps, even when its usage object carries more', () => {
    const inputOutputOnly: UsageFieldMap<FixtureUsage> = {
      inputTokens: (usage) => usage.prompt,
      outputTokens: (usage) => usage.completion,
    };
    expect(normalizeUsage({ prompt: 3, completion: 4, total: 99, cached: 2, speed: 'fast' }, inputOutputOnly)).toEqual({
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
    });
  });
});
