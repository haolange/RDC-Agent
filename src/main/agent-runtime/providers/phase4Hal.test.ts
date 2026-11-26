import { describe, expect, it } from 'vitest';
import openrouterManifest from '@shared/provider-catalog/manifests/surfaces/openrouter.json';
import {
  normalizeCacheUsage,
  finalizeProviderUsage,
  splitAnthropicCacheWrite,
  cacheHitRatePercent,
} from './internal/normalizeCacheUsage';

// =====================================================================
// 4. normalizeCacheUsage with cacheWriteLongTokens
// =====================================================================

describe('normalizeCacheUsage', () => {
  it('resolves native hit/miss tokens', () => {
    const result = normalizeCacheUsage({
      inputTokens: 1000,
      promptCacheHitTokens: 800,
      promptCacheMissTokens: 200,
    });
    expect(result).toEqual({ cacheHitTokens: 800, cacheMissTokens: 200 });
  });

  it('derives miss from inputTokens - cacheReadTokens', () => {
    const result = normalizeCacheUsage({
      inputTokens: 1000,
      cacheReadTokens: 600,
    });
    expect(result).toEqual({ cacheHitTokens: 600, cacheMissTokens: 400 });
  });

  it('returns empty when no cache telemetry', () => {
    const result = normalizeCacheUsage({ inputTokens: 500 });
    expect(result).toEqual({});
  });
});

describe('finalizeProviderUsage', () => {
  it('propagates cacheWriteLongTokens when present', () => {
    const usage = finalizeProviderUsage({
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 700,
      cacheWriteTokens: 300,
      cacheWriteLongTokens: 150,
    });
    expect(usage.cacheWriteLongTokens).toBe(150);
    expect(usage.cacheWriteTokens).toBe(300);
    expect(usage.cacheReadTokens).toBe(700);
    expect(usage.cacheHitTokens).toBe(700);
    expect(usage.cacheMissTokens).toBe(300);
  });

  it('omits cacheWriteLongTokens when absent', () => {
    const usage = finalizeProviderUsage({
      inputTokens: 500,
      outputTokens: 100,
      cacheWriteTokens: 50,
    });
    expect(usage.cacheWriteLongTokens).toBeUndefined();
    expect(usage.cacheWriteTokens).toBe(50);
  });

  it('computes totalTokens when not provided', () => {
    const usage = finalizeProviderUsage({
      inputTokens: 800,
      outputTokens: 200,
    });
    expect(usage.totalTokens).toBe(1000);
  });
});

// =====================================================================
// 5. splitAnthropicCacheWrite
// =====================================================================

describe('splitAnthropicCacheWrite', () => {
  it('returns only cacheWriteTokens when no long-lived write', () => {
    const result = splitAnthropicCacheWrite(500, undefined);
    expect(result).toEqual({ cacheWriteTokens: 500 });
  });

  it('returns only cacheWriteTokens when long-lived write is zero', () => {
    const result = splitAnthropicCacheWrite(500, 0);
    expect(result).toEqual({ cacheWriteTokens: 500 });
  });

  it('splits long-lived portion from total cache write', () => {
    const result = splitAnthropicCacheWrite(500, 200);
    expect(result).toEqual({ cacheWriteTokens: 500, cacheWriteLongTokens: 200 });
  });

  it('clamps long-lived write to total when it exceeds', () => {
    const result = splitAnthropicCacheWrite(300, 999);
    expect(result).toEqual({ cacheWriteTokens: 300, cacheWriteLongTokens: 300 });
  });
});

// =====================================================================
// 6. cacheHitRatePercent
// =====================================================================

describe('cacheHitRatePercent', () => {
  it('returns undefined when denominator is zero', () => {
    expect(cacheHitRatePercent(0, 0)).toBeUndefined();
  });

  it('computes correct percentage', () => {
    expect(cacheHitRatePercent(75, 25)).toBe(75);
    expect(cacheHitRatePercent(100, 0)).toBe(100);
    expect(cacheHitRatePercent(0, 100)).toBe(0);
  });
});

// =====================================================================
// 8. OpenRouter manifest admission policy
// =====================================================================

describe('OpenRouter manifest admission policy', () => {
  const discovery = (openrouterManifest as Record<string, unknown>).discovery as Record<string, unknown>;
  const admission = discovery.admission as Record<string, unknown>;

  it('has an admission section in discovery', () => {
    expect(admission).toBeDefined();
    expect(typeof admission).toBe('object');
  });

  it('allows top-tier providers', () => {
    const allowProviders = admission.allowProviders as string[];
    expect(allowProviders).toContain('openai');
    expect(allowProviders).toContain('anthropic');
    expect(allowProviders).toContain('google');
    expect(allowProviders).toContain('deepseek');
    expect(allowProviders).toContain('qwen');
    expect(allowProviders).toContain('mistralai');
    expect(allowProviders).toContain('x-ai');
    expect(allowProviders).toContain('moonshotai');
    expect(allowProviders).toContain('meta-llama');
    expect(allowProviders).toContain('thudm');
  });

  it('denies free/deprecated/legacy/experimental models', () => {
    const denyPatterns = admission.denyPatterns as string[];
    expect(denyPatterns).toContain(':free$');
    expect(denyPatterns).toContain('-deprecated$');
    expect(denyPatterns).toContain('-legacy$');
    expect(denyPatterns).toContain('-experimental$');
  });

  it('denies known low-quality/unknown providers', () => {
    const denyPatterns = admission.denyPatterns as string[];
    expect(denyPatterns.some((p) => p.includes('huggingfaceh4'))).toBe(true);
    expect(denyPatterns.some((p) => p.includes('gryphe'))).toBe(true);
    expect(denyPatterns.some((p) => p.includes('mancer'))).toBe(true);
  });

  it('requires tool-calling capability', () => {
    const requireCapabilities = admission.requireCapabilities as string[];
    expect(requireCapabilities).toContain('toolCalling');
  });

  it('requires explicit context window', () => {
    expect(admission.requireContextWindow).toBe(true);
  });

  it('excludes experimental models without a redundant deprecated flag', () => {
    expect(admission).not.toHaveProperty('excludeDeprecated');
    expect(admission.excludeExperimental).toBe(true);
  });
});
