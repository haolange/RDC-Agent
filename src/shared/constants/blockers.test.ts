import { describe, expect, it } from 'vitest';
import { BLOCKER_CODES, getBlockersByCategory, getBlockersBySeverity } from './blockers';

describe('blockers', () => {
  it('exposes blocker code catalog', () => {
    expect(BLOCKER_CODES.BLOCKED_MISSING_CAPTURE.code).toBe('BLOCKED_MISSING_CAPTURE');
    expect(Object.keys(BLOCKER_CODES).length).toBeGreaterThan(5);
  });

  it('filters by severity and category', () => {
    expect(getBlockersBySeverity('critical').every((b) => b.severity === 'critical')).toBe(true);
    expect(getBlockersByCategory('capture').every((b) => b.category === 'capture')).toBe(true);
    expect(getBlockersBySeverity('info').length).toBeGreaterThanOrEqual(0);
  });
});
