import type { PolicyBudgetState, SubagentBudgetState } from './TurnCoordinator';

/** Preparation mirrors child-creation budget checks; existing Task management remains available. */
export function newDelegationBudgetExhausted(
  policy?: PolicyBudgetState,
  child?: SubagentBudgetState,
  now = Date.now(),
): boolean {
  if (policy && (policy.reservedSubagentSlots ?? 0) <= 0 && (
    policy.subagents >= policy.maxSubagents
    || now - policy.wallStartedAt >= policy.maxWallTimeMs
  )) return true;
  return !!child && (
    child.depth >= child.budget.maxDepth
    || child.childrenSpawned >= child.budget.maxChildren
    || child.aggregateToolCalls >= child.budget.maxAggregateToolCalls
    || now - child.wallStartedAt >= child.budget.maxAggregateWallMs
  );
}
