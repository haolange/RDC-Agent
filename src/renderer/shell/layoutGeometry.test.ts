import { describe, expect, it } from 'vitest';
import {
  APP_MIN_MAIN_WIDTH,
  APP_MIN_WINDOW_WIDTH,
  APP_RESIZE_HANDLE_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
} from '@shared/constants/layout';
import { getResponsiveMinMainWidth, resolveResponsiveSidebarState } from './layoutGeometry';

describe('layoutGeometry', () => {
  it('keeps composer main width at the product minimum regardless of container width', () => {
    expect(getResponsiveMinMainWidth(360)).toBe(APP_MIN_MAIN_WIDTH);
    expect(getResponsiveMinMainWidth(720)).toBe(APP_MIN_MAIN_WIDTH);
    expect(getResponsiveMinMainWidth(1400)).toBe(APP_MIN_MAIN_WIDTH);
  });

  it('collapses sidebars before shrinking the main column below composer minimum', () => {
    const state = resolveResponsiveSidebarState(860, 256, 312, false, false, true);
    expect(state.rightCollapsed).toBe(true);
    expect(state.minMainWidth).toBe(APP_MIN_MAIN_WIDTH);
  });

  it('keeps window floor large enough for left rail plus one-row composer', () => {
    expect(APP_MIN_WINDOW_WIDTH).toBe(
      LEFT_SIDEBAR_MIN_WIDTH + APP_MIN_MAIN_WIDTH + APP_RESIZE_HANDLE_WIDTH,
    );
    expect(APP_MIN_WINDOW_WIDTH).toBeGreaterThanOrEqual(700);
  });
});
