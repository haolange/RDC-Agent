import { describe, expect, it } from 'vitest';
import { APP_DEFAULT_WINDOW_HEIGHT, APP_DEFAULT_WINDOW_WIDTH, APP_MIN_WINDOW_WIDTH } from '@shared/constants/layout';
import { sanitizeWindow } from './settingsSanitize';

describe('sanitizeWindow', () => {
  it('fills defaults when window layout is missing', () => {
    expect(sanitizeWindow(undefined)).toEqual({
      width: APP_DEFAULT_WINDOW_WIDTH,
      height: APP_DEFAULT_WINDOW_HEIGHT,
      x: 0,
      y: 0,
      isMaximized: false,
    });
  });

  it('clamps width to the product window floor', () => {
    const sanitized = sanitizeWindow({ width: 200, height: 900, x: 12, y: 24, isMaximized: true });
    expect(sanitized.width).toBe(APP_MIN_WINDOW_WIDTH);
    expect(sanitized.height).toBe(900);
    expect(sanitized.x).toBe(12);
    expect(sanitized.y).toBe(24);
    expect(sanitized.isMaximized).toBe(true);
  });
});
