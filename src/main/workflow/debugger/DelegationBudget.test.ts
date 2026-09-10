import { registerPolicyBudgetObserver, flushPolicyBudgetObservers } from './DelegationBudget';
import { describe, expect, it } from 'vitest';
import { deriveChildPolicyBudget } from './DelegationBudget';
import { consumeReservedSubagentSlot, createPolicyBudgetState, reserveDispatchBudget } from './TurnCoordinator';

const root = () => createPolicyBudgetState({ maxToolCalls: 100, maxSubagents: 10, maxChildDepth: 3, maxWallTimeMs: 10000 });
describe('delegated local budget with shared accounting', () => {
  it('enforces the child one-call ceiling without narrowing the parent', () => {
    const parent = root();
    const child = deriveChildPolicyBudget(parent, { maxToolCalls: 1, maxWallTimeMs: 1000, maxSubagents: 0 });
    expect(reserveDispatchBudget(child, { toolCalls: 1, subagents: 0 })).toEqual({ ok: true });
    expect(reserveDispatchBudget(child, { toolCalls: 1, subagents: 0 })).toEqual({ ok: false, limit: 'maxToolCalls' });
    expect(parent.toolCalls).toBe(1); expect(parent.maxToolCalls).toBe(100);
    expect(reserveDispatchBudget(child, { toolCalls: 0, subagents: 1 })).toEqual({ ok: false, limit: 'maxSubagents' });
    expect(parent.subagents).toBe(0);
  });
  it('reserves across siblings and nested children atomically without double charging prepaid slots', () => {
    const parent = root(); parent.maxToolCalls = 2;
    const a = deriveChildPolicyBudget(parent, { maxToolCalls: 2, maxWallTimeMs: 1000 });
    const b = deriveChildPolicyBudget(parent, { maxToolCalls: 2, maxWallTimeMs: 1000 });
    expect(reserveDispatchBudget(a, { toolCalls: 1, subagents: 1 }).ok).toBe(true);
    expect(consumeReservedSubagentSlot(a)).toBe(true);
    expect(consumeReservedSubagentSlot(parent)).toBe(false);
    const nested = deriveChildPolicyBudget(a, { maxToolCalls: 1, maxWallTimeMs: 1000 });
    expect(reserveDispatchBudget(nested, { toolCalls: 1, subagents: 0 }).ok).toBe(true);
    expect(reserveDispatchBudget(b, { toolCalls: 1, subagents: 0 })).toEqual({ ok: false, limit: 'maxToolCalls' });
    expect(parent.toolCalls).toBe(2); expect(a.toolCalls).toBe(2); expect(b.toolCalls).toBe(0);
    const retry = deriveChildPolicyBudget(parent, { maxToolCalls: 9, maxWallTimeMs: 1000 });
    expect(reserveDispatchBudget(retry, { toolCalls: 1, subagents: 0 }).ok).toBe(false);
  });
  it('preserves ancestor elapsed time instead of refreshing the deadline', () => {
    const parent = root(); parent.wallStartedAt -= 12000;
    const child = deriveChildPolicyBudget(parent, { maxToolCalls: 8, maxWallTimeMs: 30000 });
    expect(child.wallStartedAt + child.maxWallTimeMs).toBe(parent.wallStartedAt + parent.maxWallTimeMs);
    expect(reserveDispatchBudget(child, { toolCalls: 1, subagents: 0 })).toEqual({ ok: false, limit: 'maxWallTimeMs' });
  });
});


it('restores child local consumption and deadline without charging past usage twice', () => {
  const parent = root();
  const first = deriveChildPolicyBudget(parent, { maxToolCalls: 2, maxSubagents: 1, maxWallTimeMs: 1000 });
  expect(reserveDispatchBudget(first, { toolCalls: 1, subagents: 1 }).ok).toBe(true);
  const resumed = deriveChildPolicyBudget(parent, { maxToolCalls: 100, maxSubagents: 10, maxWallTimeMs: 9000 }, { ...first });
  expect(resumed.toolCalls).toBe(1); expect(resumed.maxToolCalls).toBe(2);
  expect(resumed.wallStartedAt + resumed.maxWallTimeMs).toBe(first.wallStartedAt + first.maxWallTimeMs);
  expect(parent.toolCalls).toBe(1);
  expect(reserveDispatchBudget(resumed, { toolCalls: 1, subagents: 0 }).ok).toBe(true);
  expect(parent.toolCalls).toBe(2);
  expect(reserveDispatchBudget(resumed, { toolCalls: 1, subagents: 0 }).ok).toBe(false);
  expect(reserveDispatchBudget(resumed, { toolCalls: 0, subagents: 1 }).ok).toBe(false);
});


it('does not widen restored depth constraints after a shallower reparenting', () => {
  const parent = root(); parent.maxChildDepth = 9;
  const restored = { ...parent, childDepth: 3, maxChildDepth: 3 };
  const child = deriveChildPolicyBudget(parent, { maxToolCalls: 2, maxWallTimeMs: 1000 }, restored);
  expect(child.childDepth).toBe(3); expect(child.maxChildDepth).toBe(3);
});

it('persists sibling reservations through the shared ancestor without older snapshots overwriting newer ones', async () => {
 const parent = createPolicyBudgetState();
 const a = deriveChildPolicyBudget(parent, { maxToolCalls: 2, maxWallTimeMs: 10000 });
 const b = deriveChildPolicyBudget(parent, { maxToolCalls: 2, maxWallTimeMs: 10000 });
 let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; }); const observed: number[] = [];
 const unregister = registerPolicyBudgetObserver(parent, async (snapshot) => { if (snapshot.toolCalls === 1) await gate; observed.push(snapshot.toolCalls); });
 reserveDispatchBudget(a, { toolCalls: 1, subagents: 0 }); const first = flushPolicyBudgetObservers(a);
 reserveDispatchBudget(b, { toolCalls: 1, subagents: 0 }); const second = flushPolicyBudgetObservers(b);
 await Promise.resolve(); expect(observed).toEqual([]); release(); await Promise.all([first, second]);
 expect(observed).toEqual([1, 2]); expect(a.toolCalls).toBe(1); expect(b.toolCalls).toBe(1); unregister();
});
