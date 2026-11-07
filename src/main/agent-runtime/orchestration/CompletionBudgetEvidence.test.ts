import { expect, it } from 'vitest';
import { TurnHandle } from './TurnCoordinator';
import { completionBudgetEvidence } from './CompletionBudgetEvidence';

it('distinguishes an observed current ceiling from an unlimited or still-distant budget', () => {
  const turn = new TurnHandle({ sessionKey: 'session', turnId: 'turn', generation: 1 });
  expect(completionBudgetEvidence(turn)).toBeUndefined();
  turn.providerLoopBudget = { remaining: 6, limit: 20 };
  expect(completionBudgetEvidence(turn)).toBeUndefined();
  turn.providerLoopBudget = { remaining: 2, limit: 20 };
  expect(completionBudgetEvidence(turn)).toEqual({ kind: 'provider-turns', remaining: 2, limit: 20 });
  turn.providerLoopBudget = null;
  turn.policyBudget.maxToolCalls = 3; turn.policyBudget.toolCalls = 3;
  expect(completionBudgetEvidence(turn)).toEqual({ kind: 'tool-calls', consumed: 3, limit: 3 });
});
