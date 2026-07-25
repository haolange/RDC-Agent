import { describe, expect, it } from 'vitest';
import { calculateUsageCost } from './costCalculator';
import type { Model, Usage } from '../../core/types';

function modelWithCost(cost?: Model['cost']): Pick<Model, 'cost'> {
  return { cost };
}

function usage(overrides: Partial<Omit<Usage, 'cost'>> = {}): Omit<Usage, 'cost'> {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    ...overrides,
  };
}

describe('calculateUsageCost', () => {
  it('returns undefined when model has no cost', () => {
    expect(calculateUsageCost(modelWithCost(undefined), usage())).toBeUndefined();
  });

  it('computes basic input/output cost', () => {
    const model = modelWithCost({ input: 3, output: 15 });
    const result = calculateUsageCost(model, usage({
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      totalTokens: 1_500_000,
    }));
    expect(result).toEqual({
      input: 3,
      output: 7.5,
      cacheRead: 0,
      cacheWrite: 0,
      total: 10.5,
    });
  });

  it('computes fractional token costs', () => {
    const model = modelWithCost({ input: 3, output: 15 });
    const result = calculateUsageCost(model, usage({
      inputTokens: 1_000,
      outputTokens: 2_000,
      totalTokens: 3_000,
    }));
    expect(result).toBeDefined();
    expect(result!.input).toBeCloseTo(0.003, 10);
    expect(result!.output).toBeCloseTo(0.03, 10);
    expect(result!.total).toBeCloseTo(0.033, 10);
  });

  it('includes cacheRead cost when pricing is available', () => {
    const model = modelWithCost({ input: 3, output: 15, cacheRead: 0.3 });
    const result = calculateUsageCost(model, usage({
      inputTokens: 1_000_000,
      outputTokens: 0,
      totalTokens: 1_000_000,
      cacheReadTokens: 500_000,
    }));
    expect(result).toEqual({
      input: 3,
      output: 0,
      cacheRead: 0.15,
      cacheWrite: 0,
      total: 3.15,
    });
  });

  it('includes cacheWrite cost when pricing is available', () => {
    const model = modelWithCost({ input: 3, output: 15, cacheWrite: 3.75 });
    const result = calculateUsageCost(model, usage({
      inputTokens: 1_000_000,
      outputTokens: 0,
      totalTokens: 1_000_000,
      cacheWriteTokens: 200_000,
    }));
    expect(result).toEqual({
      input: 3,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0.75,
      total: 3.75,
    });
  });

  it('applies 2x input pricing for cacheWriteLong tokens (Anthropic 1h)', () => {
    const model = modelWithCost({ input: 3, output: 15, cacheWrite: 3.75 });
    const result = calculateUsageCost(model, usage({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheWriteTokens: 1_000_000,
      cacheWriteLongTokens: 1_000_000,
    }));
    // All writes are long-lived: shortWrite = 0, longWrite = 1M
    // cacheWrite = cacheWrite_rate * max(0, 0) + input*2 * 1M = 0 + 6 = 6
    expect(result).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 6,
      total: 6,
    });
  });

  it('splits short and long cache write correctly', () => {
    const model = modelWithCost({ input: 3, output: 15, cacheWrite: 3.75 });
    const result = calculateUsageCost(model, usage({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheWriteTokens: 1_000_000,
      cacheWriteLongTokens: 400_000,
    }));
    // shortWrite = 600_000, longWrite = 400_000
    // cacheWrite = 3.75 * 0.6 + 6 * 0.4 = 2.25 + 2.4 = 4.65
    expect(result).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 4.65,
      total: 4.65,
    });
  });

  it('returns zero cost for zero tokens', () => {
    const model = modelWithCost({ input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 });
    const result = calculateUsageCost(model, usage());
    expect(result).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    });
  });

  it('handles very large token counts', () => {
    const model = modelWithCost({ input: 3, output: 15 });
    const result = calculateUsageCost(model, usage({
      inputTokens: 1_000_000_000,
      outputTokens: 1_000_000_000,
      totalTokens: 2_000_000_000,
    }));
    expect(result).toEqual({
      input: 3000,
      output: 15000,
      cacheRead: 0,
      cacheWrite: 0,
      total: 18000,
    });
  });

  it('omits cacheRead cost when cacheRead pricing is absent', () => {
    const model = modelWithCost({ input: 3, output: 15 });
    const result = calculateUsageCost(model, usage({
      inputTokens: 1_000_000,
      outputTokens: 0,
      totalTokens: 1_000_000,
      cacheReadTokens: 500_000,
    }));
    expect(result!.cacheRead).toBe(0);
  });

  it('omits cacheWrite cost when cacheWrite pricing is absent', () => {
    const model = modelWithCost({ input: 3, output: 15 });
    const result = calculateUsageCost(model, usage({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheWriteTokens: 500_000,
    }));
    expect(result!.cacheWrite).toBe(0);
  });

  it('clamps negative shortWrite to zero when longWrite exceeds cacheWriteTokens', () => {
    const model = modelWithCost({ input: 3, output: 15, cacheWrite: 3.75 });
    const result = calculateUsageCost(model, usage({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cacheWriteTokens: 100_000,
      cacheWriteLongTokens: 200_000,
    }));
    // shortWrite = 100k - 200k = -100k → clamped to 0
    // cacheWrite = 3.75 * 0 + 6 * 0.2 = 1.2
    expect(result!.cacheWrite).toBeCloseTo(1.2, 10);
  });
});
