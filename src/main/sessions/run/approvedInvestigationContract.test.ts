import { expect, it } from 'vitest';
import type { ExecutionOffer } from '@shared/types/executionOffer';
import { renderInvestigationPlanContract } from '@shared/types/planInvestigation';
import { approvedInvestigationContract } from './approvedInvestigationContract';

const offer: ExecutionOffer = { schemaVersion: '1', sourceAgentId: 'analyzer', targetAgentId: 'general',
  plan: { uri: 'session://plans/old.md', hash: 'a'.repeat(64) }, requiredSkillIds: [], label: 'Continue', prompt: 'Execute', approvedAt: 1 };

it('keeps historical plans readable but requires a matching reviewed contract for a Mission handoff', () => {
  const original = '# Historical plan\n\nInvestigate.';
  expect(() => approvedInvestigationContract(offer, original)).toThrow('APPROVED_PLAN_REVIEW_REQUIRED');
  expect(original).toBe('# Historical plan\n\nInvestigate.');
  expect(() => approvedInvestigationContract(offer, renderInvestigationPlanContract({ schemaVersion: 1, mission: 'debugger' })))
    .toThrow('APPROVED_PLAN_REVIEW_REQUIRED');
  expect(approvedInvestigationContract(offer, renderInvestigationPlanContract({ schemaVersion: 1, mission: 'analyzer' })))
    .toEqual({ schemaVersion: 1, mission: 'analyzer' });
  expect(approvedInvestigationContract({ ...offer, sourceAgentId: 'custom' }, original)).toBeNull();
});
