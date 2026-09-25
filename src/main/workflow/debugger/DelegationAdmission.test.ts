import { expect, it } from 'vitest';
import type { PolicyBudgetState, SubagentBudgetState } from './TurnCoordinator';
import { newDelegationBudgetExhausted } from './DelegationAdmission';

const policy = (now: number): PolicyBudgetState => ({
  toolCalls: 0, subagents: 0, childDepth: 0, wallStartedAt: now,
  maxToolCalls: 20, maxSubagents: 2, maxChildDepth: 2, maxWallTimeMs: 60_000,
});
const child = (now: number): SubagentBudgetState => ({
  depth: 0, childrenSpawned: 0, aggregateToolCalls: 0, wallStartedAt: now,
  budget: { maxDepth: 2, maxChildren: 2, maxAggregateToolCalls: 20, maxAggregateWallMs: 60_000 },
});

it('hides creation when inherited policy or child budget is exhausted, honoring prepaid slots', () => {
  const now = 100_000;
  expect(newDelegationBudgetExhausted(policy(now), child(now), now)).toBe(false);
  expect(newDelegationBudgetExhausted({ ...policy(now), subagents: 2 }, child(now), now)).toBe(true);
  expect(newDelegationBudgetExhausted({ ...policy(now), subagents: 2, reservedSubagentSlots: 1 }, child(now), now)).toBe(false);
  expect(newDelegationBudgetExhausted({ ...policy(now), reservedSubagentSlots: 1 }, child(now + 60_000), now + 60_000)).toBe(false);
  expect(newDelegationBudgetExhausted(policy(now), { ...child(now), childrenSpawned: 2 }, now)).toBe(true);
  expect(newDelegationBudgetExhausted(policy(now), { ...child(now), aggregateToolCalls: 20 }, now)).toBe(true);
  expect(newDelegationBudgetExhausted(policy(now), child(now), now + 60_000)).toBe(true);
});
