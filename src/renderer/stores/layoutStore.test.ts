import { describe, expect, it } from 'vitest';
import { SIDEBAR_MAX_WIDTH } from '@shared/constants/layout';
import { useLayoutStore } from './layoutStore';

describe('layoutStore', () => {
  it('clamps both docks to the same maximum width', () => {
    useLayoutStore.getState().setLeftSidebarWidth(900);
    useLayoutStore.getState().setRightPanelWidth(900);
    expect(useLayoutStore.getState().leftSidebarWidth).toBe(SIDEBAR_MAX_WIDTH);
    expect(useLayoutStore.getState().rightPanelWidth).toBe(SIDEBAR_MAX_WIDTH);
    expect(SIDEBAR_MAX_WIDTH).toBe(520);
  });
});
