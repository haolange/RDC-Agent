import { describe, expect, it } from 'vitest';
import { useAgentStore } from './agentStore';

describe('agentStore execution-state lifecycle', () => {
  it('ignores ephemeral and subagent scopes and can clear a durable session', () => {
    useAgentStore.getState().reset();
    useAgentStore.getState().updateAgentState({
      agentId: 'ask',
      sessionId: 'session-a',
      status: 'thinking',
      lastActivity: '2026-01-01T00:00:00.000Z',
    });
    useAgentStore.getState().updateAgentState({
      agentId: 'ask',
      sessionId: 'ephemeral:abc',
      status: 'thinking',
      lastActivity: '2026-01-01T00:00:00.000Z',
    });
    useAgentStore.getState().updateAgentState({
      agentId: 'edit',
      sessionId: 'session-a::subagent::child',
      status: 'thinking',
      lastActivity: '2026-01-01T00:00:00.000Z',
    });

    expect(useAgentStore.getState().getAgentState('session-a', 'ask')?.status).toBe('thinking');
    expect(useAgentStore.getState().getAgentState('ephemeral:abc', 'ask')).toBeUndefined();
    expect(useAgentStore.getState().getAgentState('session-a::subagent::child', 'edit')).toBeUndefined();

    useAgentStore.getState().clearScope('session-a');
    expect(useAgentStore.getState().getAgentState('session-a', 'ask')).toBeUndefined();
  });
});
