import { describe, expect, it } from 'vitest';
import {
  cacheHitRatePercent,
  finalizeProviderUsage,
  normalizeCacheUsage,
} from './normalizeCacheUsage';

describe('normalizeCacheUsage', () => {
  it('prefers native prompt_cache hit/miss over cacheRead', () => {
    expect(normalizeCacheUsage({
      inputTokens: 100,
      promptCacheHitTokens: 80,
      promptCacheMissTokens: 20,
      cacheReadTokens: 50,
    })).toEqual({ cacheHitTokens: 80, cacheMissTokens: 20 });
  });

  it('fills missing native side with zero when the other is present', () => {
    expect(normalizeCacheUsage({
      inputTokens: 100,
      promptCacheHitTokens: 40,
    })).toEqual({ cacheHitTokens: 40, cacheMissTokens: 0 });

    expect(normalizeCacheUsage({
      inputTokens: 100,
      promptCacheMissTokens: 15,
    })).toEqual({ cacheHitTokens: 0, cacheMissTokens: 15 });
  });

  it('falls through to cacheRead when native sides are both zero', () => {
    expect(normalizeCacheUsage({
      inputTokens: 100,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 0,
      cacheReadTokens: 30,
    })).toEqual({ cacheHitTokens: 30, cacheMissTokens: 70 });
  });

  it('falls back to cacheRead with miss = max(input - hit, 0)', () => {
    expect(normalizeCacheUsage({
      inputTokens: 100,
      cacheReadTokens: 70,
    })).toEqual({ cacheHitTokens: 70, cacheMissTokens: 30 });
  });

  it('clamps miss at zero when cacheRead exceeds input', () => {
    expect(normalizeCacheUsage({
      inputTokens: 50,
      cacheReadTokens: 80,
    })).toEqual({ cacheHitTokens: 80, cacheMissTokens: 0 });
  });

  it('fail-closes when neither native nor cacheRead is present', () => {
    expect(normalizeCacheUsage({ inputTokens: 100 })).toEqual({});
    expect(normalizeCacheUsage({
      inputTokens: 100,
      // cacheWrite alone must not invent hit/miss
    })).toEqual({});
  });

  it('ignores negative or non-finite wire values', () => {
    expect(normalizeCacheUsage({
      inputTokens: 100,
      promptCacheHitTokens: -1,
      cacheReadTokens: 40,
    })).toEqual({ cacheHitTokens: 40, cacheMissTokens: 60 });
  });
});

describe('finalizeProviderUsage', () => {
  it('attaches normalized hit/miss while preserving wire cacheRead/write', () => {
    expect(finalizeProviderUsage({
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: 60,
      cacheWriteTokens: 5,
      reasoningTokens: 3,
    })).toEqual({
      inputTokens: 100,
      outputTokens: 10,
      totalTokens: 110,
      cacheReadTokens: 60,
      cacheWriteTokens: 5,
      reasoningTokens: 3,
      cacheHitTokens: 60,
      cacheMissTokens: 40,
    });
  });

  it('maps DeepSeek native fields without requiring cacheRead', () => {
    expect(finalizeProviderUsage({
      inputTokens: 90,
      outputTokens: 5,
      promptCacheHitTokens: 70,
      promptCacheMissTokens: 20,
    })).toMatchObject({
      cacheHitTokens: 70,
      cacheMissTokens: 20,
    });
  });
});

describe('cacheHitRatePercent', () => {
  it('returns rounded percent and omits zero denominator', () => {
    expect(cacheHitRatePercent(80, 20)).toBe(80);
    expect(cacheHitRatePercent(1, 2)).toBe(33);
    expect(cacheHitRatePercent(0, 0)).toBeUndefined();
  });
});
