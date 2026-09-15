import { describe, expect, it } from 'vitest';
import { TERMINAL_WINDOW_THRESHOLD, terminalActivityWindow } from './terminalActivityWindow';

describe('terminalActivityWindow', () => {
  it('keeps short lists fully addressable', () => {
    expect(terminalActivityWindow(TERMINAL_WINDOW_THRESHOLD, 0, 200)).toEqual({
      start: 0,
      end: TERMINAL_WINDOW_THRESHOLD,
    });
  });

  it('windows long lists without dropping older entries from the scroll range', () => {
    const count = 200;
    const estimate = 56;
    const top = terminalActivityWindow(count, 0, 200, estimate, 4);
    expect(top.start).toBe(0);
    expect(top.end).toBeGreaterThan(0);
    const bottom = terminalActivityWindow(count, (count - 1) * estimate, 200, estimate, 4);
    expect(bottom.end).toBe(count);
    expect(bottom.start).toBeLessThan(count);
    const middle = terminalActivityWindow(count, 80 * estimate, 200, estimate, 4);
    expect(middle.start).toBeGreaterThan(0);
    expect(middle.end).toBeLessThan(count);
    expect(middle.end - middle.start).toBeLessThan(count);
  });
});
