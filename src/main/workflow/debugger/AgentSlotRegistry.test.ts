import { describe, expect, it } from 'vitest';
import { AgentSlotRegistry, agentSlotKey } from './AgentSlotRegistry';
import type { AgentSlot } from './AgentSlotRegistry';
import { createEphemeralScopeId, isTransientExecutionScope } from './executionScope';

function mockSlot(): AgentSlot {
  return {
    agent: {
      abort: () => undefined,
      clearMessages: () => undefined,
      isStreaming: false,
      activeLoopPromise: null,
    },
    contextManager: {},
    providerId: 'test',
    modelId: 'model',
    systemPrompt: 'sys',
    toolSignature: 'tools',
    turnSignature: 'turn',
    contextTokenLimit: 1000,
    activatedDeferredTools: new Set<string>(),
  } as unknown as AgentSlot;
}

describe('AgentSlotRegistry compiledRoute apply', () => {
  it('applies compiledRoute and does not use leftover agentRoutes or DEFAULT_MODEL_ROUTING', () => {
    const registry = new AgentSlotRegistry();
    registry.initializeDefaults();
    expect(registry.getAgentConfig('general')?.modelProvider).toBe('openrouter');

    registry.applyLlmConfig([
      { agentId: 'general', providerId: 'real', modelId: 'real-model' },
    ]);
    expect(registry.getAgentConfig('general')).toMatchObject({
      modelProvider: 'real',
      modelName: 'real-model',
    });

    registry.applyLlmConfig([]);
    expect(registry.getAgentConfig('general')).toMatchObject({
      modelProvider: '',
      modelName: '',
    });
  });
});

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

  it('clears slots and states when syncSession runs after setSlot', () => {
    const registry = new AgentSlotRegistry();
    const slotKey = agentSlotKey('session-a', 'ask');
    registry.setSlot(slotKey, mockSlot());
    registry.updateAgentStatus('session-a', 'ask', 'thinking');
    registry.updateAgentStatus('session-a::subagent::child', 'edit', 'thinking');
    registry.updateAgentStatus('session-b', 'ask', 'idle');

    expect(registry.getSlot(slotKey)).toBeTruthy();
    registry.syncSession('session-a');

    expect(registry.getSlot(slotKey)).toBeUndefined();
    expect(registry.getAgentState('session-a', 'ask')).toBeNull();
    expect(registry.getAgentState('session-a::subagent::child', 'edit')).toBeNull();
    expect(registry.getAgentState('session-b', 'ask')?.sessionId).toBe('session-b');
  });

  it('does not accumulate ephemeral states across repeated update+purge cycles', () => {
    const registry = new AgentSlotRegistry();
    for (let index = 0; index < 8; index += 1) {
      const scopeId = createEphemeralScopeId();
      registry.updateAgentStatus(scopeId, 'ask', 'complete');
      expect(registry.purgeAgentStatesForScope(scopeId)).toBe(1);
    }
    expect(registry.getAllAgentStates()).toHaveLength(0);
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
