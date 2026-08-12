import { describe, expect, it } from 'vitest';
import { AgentSlotRegistry } from './AgentSlotRegistry';
import { createEphemeralScopeId, isTransientExecutionScope } from './executionScope';

describe('AgentSlotRegistry agent state lifecycle', () => {
  it('does not accumulate ephemeral scopes after purge', () => {
    const registry = new AgentSlotRegistry();
    const first = createEphemeralScopeId();
    const second = createEphemeralScopeId();
    registry.updateAgentStatus(first, 'ask', 'complete');
    registry.updateAgentStatus(second, 'ask', 'complete');
    expect(registry.getAllAgentStates()).toHaveLength(2);

    expect(registry.purgeAgentStatesForScope(first)).toBe(1);
    expect(registry.getAgentState(first, 'ask')).toBeNull();
    expect(registry.getAllAgentStates()).toHaveLength(1);
    expect(registry.getAgentState(second, 'ask')?.status).toBe('complete');
  });

  it('syncSession removes session-scoped states including nested subagent scopes', () => {
    const registry = new AgentSlotRegistry();
    registry.updateAgentStatus('session-a', 'ask', 'thinking');
    registry.updateAgentStatus('session-a::subagent::child', 'edit', 'thinking');
    registry.updateAgentStatus('session-b', 'ask', 'idle');

    registry.syncSession('session-a');

    expect(registry.getAgentState('session-a', 'ask')).toBeNull();
    expect(registry.getAgentState('session-a::subagent::child', 'edit')).toBeNull();
    expect(registry.getAgentState('session-b', 'ask')?.sessionId).toBe('session-b');
  });

  it('treats ephemeral and subagent scopes as transient', () => {
    expect(isTransientExecutionScope(createEphemeralScopeId())).toBe(true);
    expect(isTransientExecutionScope('sess::subagent::abc')).toBe(true);
    expect(isTransientExecutionScope('durable-session')).toBe(false);
  });
});
