import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID } from '@shared/types/agent';
import { SIDEBAR_MAX_WIDTH } from '@shared/constants/layout';
import { useLayoutStore } from './layoutStore';

describe('layoutStore identity', () => {
  it('defaults both currentMode and selectedAgentId to general', () => {
    const state = useLayoutStore.getInitialState();
    expect(state.currentMode).toBe(DEFAULT_AGENT_ID);
    expect(state.selectedAgentId).toBe('general');
    expect(state.selectedAgentId).not.toBe('ask');
  });

  it('clamps both docks to the same maximum width', () => {
    useLayoutStore.getState().setLeftSidebarWidth(900);
    useLayoutStore.getState().setRightPanelWidth(900);
    expect(useLayoutStore.getState().leftSidebarWidth).toBe(SIDEBAR_MAX_WIDTH);
    expect(useLayoutStore.getState().rightPanelWidth).toBe(SIDEBAR_MAX_WIDTH);
    expect(SIDEBAR_MAX_WIDTH).toBe(520);
  });
});
