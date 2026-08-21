import { describe, expect, it } from 'vitest';
import {
  resolveCompactionThresholdTokens,
  resolveEffectiveCompactionPercent,
  resolveTurnOutputTokens,
  sanitizeCompactionThresholdPercent,
} from './contextBudget';

describe('sanitizeCompactionThresholdPercent', () => {
  it('defaults, clamps 50–90, and snaps to step 5', () => {
    expect(sanitizeCompactionThresholdPercent(undefined)).toBe(80);
    expect(sanitizeCompactionThresholdPercent(50)).toBe(50);
    expect(sanitizeCompactionThresholdPercent(90)).toBe(90);
    expect(sanitizeCompactionThresholdPercent(47)).toBe(50);
    expect(sanitizeCompactionThresholdPercent(94)).toBe(90);
    expect(sanitizeCompactionThresholdPercent(73)).toBe(75);
    expect(sanitizeCompactionThresholdPercent(72)).toBe(70);
  });
});

describe('resolveEffectiveCompactionPercent', () => {
  it('keeps the user percent when policy is unlimited', () => {
    expect(resolveEffectiveCompactionPercent(80, 100)).toBe(80);
    expect(resolveEffectiveCompactionPercent(80, Number.MAX_SAFE_INTEGER)).toBe(80);
  });

  it('takes the lower of user and policy without loosening past a step', () => {
    expect(resolveEffectiveCompactionPercent(80, 70)).toBe(70);
    expect(resolveEffectiveCompactionPercent(80, 73)).toBe(70);
    expect(resolveEffectiveCompactionPercent(50, 40)).toBe(50);
  });
});

describe('resolveCompactionThresholdTokens', () => {
  it('applies the percent to the prompt budget', () => {
    expect(resolveCompactionThresholdTokens(1_000_000, 80)).toBe(800_000);
    expect(resolveCompactionThresholdTokens(200_000, 80)).toBe(160_000);
    expect(resolveCompactionThresholdTokens(0, 80)).toBe(0);
  });
});

describe('resolveTurnOutputTokens', () => {
  it('caps by model max output when the window still has room', () => {
    expect(resolveTurnOutputTokens({
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 384_000,
      promptTokens: 0,
    })).toBe(384_000);
  });

  it('uses remaining window minus safety when prompt is near the compaction line', () => {
    expect(resolveTurnOutputTokens({
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 384_000,
      promptTokens: 800_000,
    })).toBe(184_000);
  });

  it('returns null when no output can fit', () => {
    expect(resolveTurnOutputTokens({
      contextWindowTokens: 200_000,
      maxOutputTokens: 64_000,
      promptTokens: 199_500,
    })).toBeNull();
    expect(resolveTurnOutputTokens({
      contextWindowTokens: 200_000,
      maxOutputTokens: 0,
      promptTokens: 1_000,
    })).toBeNull();
  });
});
