import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_ID } from '@shared/types/agent';
import { useLayoutStore } from './layoutStore';

describe('layoutStore identity', () => {
  it('defaults both currentMode and selectedAgentId to general', () => {
    const state = useLayoutStore.getInitialState();
    expect(state.currentMode).toBe(DEFAULT_AGENT_ID);
    expect(state.selectedAgentId).toBe('general');
    expect(state.selectedAgentId).not.toBe('ask');
  });
});
