import { describe, expect, it } from 'vitest';
import { resolvePromptClock } from './promptClock';

describe('resolvePromptClock', () => {
  it('returns ISO-like local date and a timezone string', () => {
    const clock = resolvePromptClock();
    expect(clock.currentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof clock.timeZone).toBe('string');
    expect(clock.timeZone.length).toBeGreaterThan(0);
  });
});
