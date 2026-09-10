import { describe, expect, it } from 'vitest';
import { enforceTaskReturnBinding, type TurnCompletionInput } from './TurnCompletionValidator';
const input: TurnCompletionInput = {
  profileId: 'custom-worker', finalAnswerText: 'partial', disposition: 'partial',
  taskBinding: { handoffId: 'execution', returnTo: 'custom-planner', deliveryRequirements: 'artifact', dispatchedAt: 0, validationPolicy: 'none' },
};
describe('generic execution return contract', () => {
  it('does not require a domain profile and cannot be bypassed by partial text or status', () => {
    expect(() => enforceTaskReturnBinding(input, null)).toThrow(/must return/);
  });
  it('requires the actual dispatcher and exact execution binding', () => {
    const returning = { ...input, pendingHandoff: true, pendingHandoffTarget: 'custom-planner' };
    expect(() => enforceTaskReturnBinding(returning, { contract: { intent: 'return', executionHandoffId: 'old', artifacts: [] } })).toThrow(/frozen/);
    expect(() => enforceTaskReturnBinding(returning, { contract: { intent: 'return', executionHandoffId: 'execution', artifacts: [] } })).not.toThrow();
    expect(() => enforceTaskReturnBinding({ ...returning, pendingHandoffTarget: 'other' }, null)).toThrow(/must return/);
  });
  it('allows ordinary direct work without any execution binding', () => {
    expect(() => enforceTaskReturnBinding({ profileId: 'general', finalAnswerText: 'done' }, null)).not.toThrow();
  });
});
