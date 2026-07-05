import { describe, expect, it } from 'vitest';
import {
  findAdjacentSupportedLevel,
  getStopPosition,
  normalizeDisplayLevels,
  resolveNearestSnapLevel,
} from './effortControlParts';

describe('effortControlParts', () => {
  it('renders only supported reasoning levels in canonical order', () => {
    expect(normalizeDisplayLevels(['auto', 'off'])).toEqual(['off', 'auto']);
    expect(normalizeDisplayLevels(['high', 'off', 'medium', 'auto', 'low', 'extHigh'])).toEqual([
      'off',
      'auto',
      'low',
      'medium',
      'high',
      'extHigh',
    ]);
    expect(normalizeDisplayLevels(undefined)).toEqual(['off']);
  });

  it('spaces stops by the visible supported subset', () => {
    expect(getStopPosition(0, 2)).toBe(0);
    expect(getStopPosition(1, 2)).toBe(1);
    expect(getStopPosition(2, 5)).toBe(0.5);
  });

  it('rounds pointer ratios to the nearest visible supported level', () => {
    expect(resolveNearestSnapLevel(0.49, ['off', 'auto'])).toBe('off');
    expect(resolveNearestSnapLevel(0.51, ['off', 'auto'])).toBe('auto');
    expect(resolveNearestSnapLevel(0.44, ['off', 'auto', 'low', 'medium', 'high'])).toBe('low');
    expect(resolveNearestSnapLevel(0.74, ['off', 'auto', 'low', 'medium', 'high'])).toBe('medium');
    expect(resolveNearestSnapLevel(0.88, ['off', 'auto', 'low', 'medium', 'high'])).toBe('high');
  });

  it('rounds over the current supported subset instead of hidden canonical levels', () => {
    expect(resolveNearestSnapLevel(0.74, ['off', 'auto', 'low', 'medium', 'high', 'max'])).toBe('high');
    expect(resolveNearestSnapLevel(0.91, ['off', 'auto', 'low', 'medium', 'high', 'max'])).toBe('max');
  });

  it('moves keyboard focus through the visible supported subset only', () => {
    const levels = ['off', 'auto', 'low', 'medium', 'high'] as const;
    expect(findAdjacentSupportedLevel('auto', 1, [...levels])).toBe('low');
    expect(findAdjacentSupportedLevel('auto', -1, [...levels])).toBe('off');
    expect(findAdjacentSupportedLevel('high', 1, [...levels])).toBeNull();
  });
});
