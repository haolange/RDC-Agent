import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryTaskStore, TaskRegistry } from '../../agent-runtime/tasks';
import { deriveChildPolicyBudget } from './DelegationBudget';
import { bindTaskRootBudget, getBoundTaskRootBudgetId, taskRootBudgetId } from './TaskRootBudget';
import { readLiveTaskBudget } from './TaskRuntimeBudgetView';
import { createPolicyBudgetState, createSubagentBudgetState, finishSubagentBudgetChild,
  reserveDispatchBudget, startSubagentBudgetChild, TurnHandle } from './TurnCoordinator';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-20T00:00:00Z')); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

async function fixture(maxWallTimeMs = 60_000) {
  const registry = new TaskRegistry(new MemoryTaskStore());
  const policy = createPolicyBudgetState({ maxToolCalls: 30, maxSubagents: 4, maxChildDepth: 3, maxWallTimeMs });
  policy.toolCalls = 11;
  await bindTaskRootBudget(registry, 'owner', policy, 'root-a');
  const turn = new TurnHandle({ sessionKey: 'owner', turnId: 'current-turn', generation: 3, policyBudget: policy });
  return { registry, policy, turn };
}

describe('active Task budget observation', () => {
  it('reads actual policy counters without reservations, mutation or live object aliases', async () => {
    const { registry, policy, turn } = await fixture();
    const before = await registry.getRootBudget('root-a');
    const snapshot = readLiveTaskBudget(turn, 'root-a');
    expect(snapshot).toMatchObject({ turnId: 'current-turn', generation: 3,
      remainingPolicy: { toolCalls: 19, subagents: 4, wallTimeMs: 60_000 }, reservedSubagentSlots: 0,
      subagentTreeAdmission: { allowed: true, childrenSpawned: 0, activeChildren: 0 } });
    expect(policy.toolCalls).toBe(11);
    expect(policy.subagents).toBe(0);
    expect(await registry.getRootBudget('root-a')).toEqual(before);
    policy.toolCalls = 12;
    expect(snapshot!.policyChain[0]!.toolCalls).toBe(11);
  });

  it('takes the remaining minimum across the actual child and ancestor policy ledgers', async () => {
    const { policy, turn } = await fixture();
    const child = deriveChildPolicyBudget(policy, { maxToolCalls: 4, maxSubagents: 0, maxWallTimeMs: 4_000 });
    expect(reserveDispatchBudget(child, { toolCalls: 1, subagents: 0 })).toEqual({ ok: true });
    const childTurn = new TurnHandle({ sessionKey: 'owner::subagent::child', turnId: 'child-turn', generation: 1,
      policyBudget: child, subagentBudget: createSubagentBudgetState(undefined, 1) });
    const snapshot = readLiveTaskBudget(childTurn, 'root-a');
    expect(snapshot?.remainingPolicy).toEqual({ toolCalls: 3, subagents: 0, wallTimeMs: 4_000 });
    expect(snapshot?.policyChain.map(item => item.toolCalls)).toEqual([1, 12]);
    expect(turn.policyBudget.toolCalls).toBe(12);
    expect(child.toolCalls).toBe(1);
  });

  it('does not bind an unbound turn, apply another roots limits, or expose an ended turn as live', async () => {
    const { registry, turn } = await fixture();
    expect(readLiveTaskBudget(turn, 'different-root')).toBeNull();
    const unbound = new TurnHandle({ sessionKey: 'owner', turnId: 'unbound-turn', generation: 1 });
    expect(readLiveTaskBudget(unbound, 'root-a')).toBeNull();
    expect(getBoundTaskRootBudgetId(unbound.policyBudget)).toBeUndefined();
    expect(await registry.getRootBudget(taskRootBudgetId(unbound.policyBudget))).toBeNull();
    vi.spyOn(turn, 'isLive').mockReturnValue(false);
    expect(readLiveTaskBudget(turn, 'root-a')).toBeNull();
  });

  it('shows a refused subagent-tree admission separately without modifying current policy capacity', async () => {
    const { policy, turn } = await fixture();
    turn.subagentBudget.childrenSpawned = turn.subagentBudget.budget.maxChildren;
    const snapshot = readLiveTaskBudget(turn, 'root-a');
    expect(snapshot?.subagentTreeAdmission).toMatchObject({ allowed: false, reason: expect.stringContaining('maxChildren') });
    expect(snapshot?.remainingPolicy.toolCalls).toBe(19);
    expect(policy.toolCalls).toBe(11);
    expect(turn.subagentBudget.childrenSpawned).toBe(5);
  });

  it('does not spend child active-wall admission time during idle parent work', async () => {
    const { turn } = await fixture(3_000_000);
    turn.subagentBudget.budget.maxAggregateWallMs = 5_000;
    const started = Date.now();
    startSubagentBudgetChild(turn.subagentBudget, started);
    vi.setSystemTime(started + 1_000);
    finishSubagentBudgetChild(turn.subagentBudget);
    vi.setSystemTime(started + 100_000);
    expect(readLiveTaskBudget(turn, 'root-a')?.subagentTreeAdmission).toMatchObject({ allowed: true, childrenSpawned: 1, activeChildren: 0 });
  });
});
