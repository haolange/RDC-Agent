import type { TaskLiveBudgetSnapshot } from '../../agent-runtime/tasks/TaskBudgetSnapshot';
import { policyBudgetChain } from './DelegationBudget';
import { getBoundTaskRootBudgetId } from './TaskRootBudget';
import { assertSubagentBudgetAllowsChild, type TurnHandle } from './TurnCoordinator';

/** Project the actual in-memory enforcement ledgers; do not reserve or rebind them. */
export function readLiveTaskBudget(turn: TurnHandle | null, rootBudgetId: string): TaskLiveBudgetSnapshot | null {
  if (!turn?.isLive(turn.generation) || getBoundTaskRootBudgetId(turn.policyBudget) !== rootBudgetId) return null;
  const now = Date.now();
  const chain = policyBudgetChain(turn.policyBudget);
  let reason: string | null = null;
  try { assertSubagentBudgetAllowsChild(turn.subagentBudget, now); }
  catch (error) { reason = error instanceof Error ? error.message : String(error); }
  return {
    turnId: turn.turnId,
    generation: turn.generation,
    policyChain: chain.map(budget => ({
      toolCalls: budget.toolCalls, subagents: budget.subagents, childDepth: budget.childDepth,
      maxToolCalls: budget.maxToolCalls, maxSubagents: budget.maxSubagents, maxChildDepth: budget.maxChildDepth,
      startedAt: budget.wallStartedAt, deadlineAt: budget.wallStartedAt + budget.maxWallTimeMs,
    })),
    remainingPolicy: {
      toolCalls: Math.max(0, Math.min(...chain.map(budget => budget.maxToolCalls - budget.toolCalls))),
      subagents: Math.max(0, Math.min(...chain.map(budget => budget.maxSubagents - budget.subagents))),
      wallTimeMs: Math.max(0, Math.min(...chain.map(budget => budget.wallStartedAt + budget.maxWallTimeMs - now))),
    },
    reservedSubagentSlots: turn.policyBudget.reservedSubagentSlots ?? 0,
    subagentTreeAdmission: { allowed: reason === null, reason,
      childrenSpawned: turn.subagentBudget.childrenSpawned, activeChildren: turn.subagentBudget.activeChildren },
  };
}
