import type { TurnCompletionInput } from '../agent/TurnCompletionValidator';
import type { TurnHandle } from './TurnCoordinator';

/** Produce evidence only from a currently configured and observed limit. */
export function completionBudgetEvidence(turn: TurnHandle): TurnCompletionInput['budgetEvidence'] {
  const provider = turn.providerLoopBudget;
  if (provider && Number.isFinite(provider.limit) && provider.remaining >= 1 && provider.remaining <= 5) {
    return { kind: 'provider-turns', remaining: provider.remaining, limit: provider.limit };
  }
  const policy = turn.policyBudget;
  if (policy.maxToolCalls < Number.MAX_SAFE_INTEGER && policy.toolCalls >= policy.maxToolCalls) {
    return { kind: 'tool-calls', consumed: policy.toolCalls, limit: policy.maxToolCalls };
  }
  return undefined;
}
