import { describe, it, expect, beforeEach } from 'vitest';
import {
  TurnCoordinator,
  TurnHandle,
  createSubagentBudgetState,
  assertSubagentBudgetAllowsChild,
  DEFAULT_SUBAGENT_BUDGET,
  createPolicyBudgetState,
  assertPolicyWallTimeAllowed,
} from './TurnCoordinator';
import type { AgentEvent } from '@shared/types/agentRuntime';

function makeEvent(id: string): AgentEvent {
  return {
    id,
    type: 'assistant.delta',
    timestamp: Date.now(),
    sessionId: 's1',
    agentId: 'ask',
    payload: { text: id },
  } as AgentEvent;
}

describe('TurnCoordinator', () => {
  let coordinator: TurnCoordinator;

  beforeEach(() => {
    coordinator = new TurnCoordinator();
  });

  it('isolates per-session active turns', async () => {
    const a = await coordinator.beginTurn({
      sessionKey: 'session-a',
      turnId: 't1',
      eventSink: { sessionId: 'session-a' },
    });
    const b = await coordinator.beginTurn({
      sessionKey: 'session-b',
      turnId: 't2',
      eventSink: { sessionId: 'session-b' },
    });
    expect(coordinator.getActive('session-a')).toBe(a);
    expect(coordinator.getActive('session-b')).toBe(b);
    expect(a.generation).not.toBe(b.generation);
  });

  it('generation token drops late events after abort', async () => {
    const received: string[] = [];
    const handle = await coordinator.beginTurn({
      sessionKey: 's',
      turnId: 't',
      eventSink: {
        onEvent: (e) => received.push(e.id),
        sessionId: 's',
      },
    });
    const gen = handle.generation;
    expect(handle.emitEvent(makeEvent('early'), gen)).toBe(true);
    await handle.abortAndJoin({ reason: 'user_stop' });
    expect(handle.emitEvent(makeEvent('late'), gen)).toBe(false);
    expect(received).toEqual(['early']);
  });

  it('abortAndJoin waits for registered producers', async () => {
    const handle = await coordinator.beginTurn({ sessionKey: 's', turnId: 't' });
    let joined = false;
    handle.registerProducer({
      id: 'p1',
      abort: () => undefined,
      join: async () => {
        await new Promise((r) => setTimeout(r, 50));
        joined = true;
      },
    });
    await handle.abortAndJoin({ reason: 'user_stop', graceMs: 500, forceAfterMs: 1_000 });
    expect(joined).toBe(true);
    expect(handle.isAborted).toBe(true);
    expect(handle.reason).toBe('user_stop');
  });

  it('marks an unjoined producer orphaned without dropping its ownership', async () => {
    const handle = await coordinator.beginTurn({ sessionKey: 'orphan', turnId: 't' });
    let resolveJoin!: () => void;
    const joinPromise = new Promise<void>((resolve) => { resolveJoin = resolve; });
    handle.registerProducer({
      id: 'slow',
      abort: () => undefined,
      join: () => joinPromise,
    });

    await handle.abortAndJoin({ reason: 'user_stop', graceMs: 5, forceAfterMs: 5 });
    expect(handle.isOrphaned).toBe(true);
    expect(handle.isLive(handle.generation)).toBe(false);

    resolveJoin();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('replacing session turn aborts previous', async () => {
    const first = await coordinator.beginTurn({ sessionKey: 's', turnId: 't1' });
    const second = await coordinator.beginTurn({ sessionKey: 's', turnId: 't2' });
    expect(first.isAborted).toBe(true);
    expect(coordinator.getActive('s')).toBe(second);
  });

  it('abortAll clears every session', async () => {
    await coordinator.beginTurn({ sessionKey: 'a', turnId: '1' });
    await coordinator.beginTurn({ sessionKey: 'b', turnId: '2' });
    await coordinator.abortAll('app_shutdown');
    expect(coordinator.getActive('a')).toBeNull();
    expect(coordinator.getActive('b')).toBeNull();
  });
});

describe('SubagentBudget', () => {
  it('enforces maxDepth / maxChildren', () => {
    const state = createSubagentBudgetState({ ...DEFAULT_SUBAGENT_BUDGET, maxDepth: 2, maxChildren: 1 });
    assertSubagentBudgetAllowsChild(state);
    state.childrenSpawned += 1;
    expect(() => assertSubagentBudgetAllowsChild(state)).toThrow(/maxChildren/);

    const deep = createSubagentBudgetState(DEFAULT_SUBAGENT_BUDGET, 3);
    expect(() => assertSubagentBudgetAllowsChild(deep)).toThrow(/maxDepth/);
  });

  it('TurnHandle carries child budget depth', () => {
    const parent = new TurnHandle({
      sessionKey: 's',
      turnId: 't',
      generation: 1,
      subagentBudget: createSubagentBudgetState(DEFAULT_SUBAGENT_BUDGET, 1),
    });
    expect(parent.subagentBudget.depth).toBe(1);
  });

  it('rejects a zero policy wall time before creating a timer', () => {
    expect(() => createPolicyBudgetState({
      maxToolCalls: 1,
      maxSubagents: 1,
      maxChildDepth: 1,
      maxWallTimeMs: 0,
    })).toThrow(/POLICY_MAX_WALL_TIME_ZERO/);
    expect(() => assertPolicyWallTimeAllowed(0)).toThrow(/POLICY_MAX_WALL_TIME_ZERO/);
    expect(() => new TurnHandle({
      sessionKey: 's',
      turnId: 't',
      generation: 1,
      policyBudget: {
        toolCalls: 0,
        subagents: 0,
        childDepth: 0,
        wallStartedAt: Date.now(),
        maxToolCalls: 1,
        maxSubagents: 1,
        maxChildDepth: 1,
        maxWallTimeMs: 0,
      },
    })).toThrow(/POLICY_MAX_WALL_TIME_ZERO/);
  });
});
