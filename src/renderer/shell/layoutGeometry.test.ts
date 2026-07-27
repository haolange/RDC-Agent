import { describe, expect, it } from 'vitest';
import { APP_MIN_MAIN_WIDTH } from '@shared/constants/layout';
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
});
