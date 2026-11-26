import { expect, it } from 'vitest';
import { renderInvestigationPlanContract } from './investigationPlanContract';
import { approvedInvestigationContract } from './approvedInvestigationContract';
import type { ExecutionOffer } from './executionOffer';

const offer: ExecutionOffer = {
  sourceAgentId: 'analyzer',
  targetAgentId: 'general',
  plan: { uri: 'session://plans/old.md', hash: 'a'.repeat(64) },
  requiredSkillIds: [],
  label: 'Continue',
  prompt: 'Execute',
  approvedAt: 1,
};

it('keeps historical plans readable but requires a matching reviewed contract for a Mission handoff', () => {
  const original = '# Historical plan\n\nInvestigate.';
  expect(() => approvedInvestigationContract(offer, original)).toThrow('APPROVED_PLAN_REVIEW_REQUIRED');
  expect(original).toBe('# Historical plan\n\nInvestigate.');
  expect(() => approvedInvestigationContract(offer, renderInvestigationPlanContract({ mission: 'debugger' }))).toThrow(
    'APPROVED_PLAN_REVIEW_REQUIRED',
  );
  expect(approvedInvestigationContract(offer, renderInvestigationPlanContract({ mission: 'analyzer' }))).toEqual({
    mission: 'analyzer',
  });
  expect(approvedInvestigationContract({ ...offer, sourceAgentId: 'custom' }, original)).toBeNull();
});
