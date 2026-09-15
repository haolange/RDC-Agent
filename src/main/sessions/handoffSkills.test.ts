import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXECUTION_OFFER_SCHEMA } from '@shared/types/executionOffer';
import { executionOfferRequiredSkillIds } from './handoffSkills';

const mocks = vi.hoisted(() => ({
  offerRead: vi.fn(),
  planRead: vi.fn(),
}));

vi.mock('./StorageAdapter', () => ({
  storageAdapter: {
    executionOffers: { read: mocks.offerRead },
  },
}));
vi.mock('./PlanReviewStateStore', () => ({
  planReviewStateStore: { read: mocks.planRead },
}));

const offer = {
  schemaVersion: EXECUTION_OFFER_SCHEMA,
  sourceAgentId: 'debugger',
  targetAgentId: 'general',
  plan: { uri: 'session://plans/plan-frozen.md', hash: 'a'.repeat(64) },
  requiredSkillIds: ['renderdoc-execution', 'debugger-causal-method'],
  label: 'Execute with General',
  prompt: 'Execute the frozen plan.',
  approvedAt: 1,
};

describe('executionOfferRequiredSkillIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.offerRead.mockReturnValue(offer);
    mocks.planRead.mockReturnValue({
      status: 'approved',
      approvedHash: 'a'.repeat(64),
      frozenUri: 'session://plans/plan-frozen.md',
    });
  });

  it('returns declared skills only when the recipient and frozen plan match', () => {
    expect(executionOfferRequiredSkillIds('sess', 'general')).toEqual([
      'renderdoc-execution',
      'debugger-causal-method',
    ]);
  });

  it('returns nothing for a different agent or a different plan hash', () => {
    expect(executionOfferRequiredSkillIds('sess', 'debugger')).toEqual([]);
    mocks.planRead.mockReturnValue({
      status: 'approved',
      approvedHash: 'b'.repeat(64),
      frozenUri: 'session://plans/plan-frozen.md',
    });
    expect(executionOfferRequiredSkillIds('sess', 'general')).toEqual([]);
  });

  it('returns nothing when the plan is not approved', () => {
    mocks.planRead.mockReturnValue({ status: 'rejected', approvedHash: 'a'.repeat(64) });
    expect(executionOfferRequiredSkillIds('sess', 'general')).toEqual([]);
  });
});
