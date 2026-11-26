import { describe, expect, it } from 'vitest';
import {
  APP_MIN_MAIN_WIDTH,
  APP_MIN_WINDOW_WIDTH,
  APP_RESIZE_HANDLE_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
} from '@shared/constants/layout';
import { resolveResponsiveSidebarState } from './layoutGeometry';

describe('layoutGeometry', () => {
  it('collapses sidebars before shrinking the main column below composer minimum', () => {
    const state = resolveResponsiveSidebarState(860, 256, 312, false, false, true);
    expect(state.rightCollapsed).toBe(true);
    expect(state.minMainWidth).toBe(APP_MIN_MAIN_WIDTH);
  });

  it('keeps window floor large enough for left rail plus one-row composer', () => {
    expect(APP_MIN_WINDOW_WIDTH).toBe(LEFT_SIDEBAR_MIN_WIDTH + APP_MIN_MAIN_WIDTH + APP_RESIZE_HANDLE_WIDTH);
    expect(APP_MIN_WINDOW_WIDTH).toBeGreaterThanOrEqual(700);
  });
});
