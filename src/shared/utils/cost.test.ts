import { describe, expect, it } from 'vitest';
import { formatPricePerMillion, formatUsdCost } from './cost';

describe('cost formatting', () => {
  it('formats small non-zero USD costs with four decimals', () => {
    expect(formatUsdCost(0.0042)).toBe('$0.0042');
    expect(formatUsdCost(-0.0042)).toBe('$-0.0042');
  });

  it('formats zero and normal USD costs with two decimals', () => {
    expect(formatUsdCost(0)).toBe('$0.00');
    expect(formatUsdCost(12.345)).toBe('$12.35');
  });

  it('formats per-million-token prices with two decimals', () => {
    expect(formatPricePerMillion(1.2)).toBe('$1.20');
  });
});
