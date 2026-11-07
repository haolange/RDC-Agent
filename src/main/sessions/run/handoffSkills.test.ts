import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXECUTION_OFFER_SCHEMA } from '@shared/types/executionOffer';
import { approvedExecutionOfferForAgent, executionOfferRequiredSkillIds } from './handoffSkills';

const mocks = vi.hoisted(() => ({
  offerRead: vi.fn(),
  planRead: vi.fn(),
  journalRead: vi.fn(),
}));

vi.mock('../store/StorageAdapter', () => ({
  storageAdapter: {
    executionOffers: { read: mocks.offerRead },
    readSessionContextJournal: mocks.journalRead,
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
    mocks.journalRead.mockReturnValue([]);
    mocks.planRead.mockReturnValue({
      status: 'approved',
      approvedHash: 'a'.repeat(64),
      frozenUri: 'session://plans/plan-frozen.md',
      approvedHandoff: { agent: 'general', label: 'Execute with General' },
      updatedAt: 1,
    });
  });

  it('returns declared skills only when the recipient and frozen plan match', () => {
    expect(approvedExecutionOfferForAgent('sess', 'general')).toEqual(offer);
    expect(executionOfferRequiredSkillIds('sess', 'general')).toEqual([
      'renderdoc-execution',
      'debugger-causal-method',
    ]);
  });

  it('returns nothing for a different agent or a different plan hash', () => {
    expect(approvedExecutionOfferForAgent('sess', 'debugger')).toBeNull();
    expect(executionOfferRequiredSkillIds('sess', 'debugger')).toEqual([]);
    mocks.planRead.mockReturnValue({
      status: 'approved',
      approvedHash: 'b'.repeat(64),
      frozenUri: 'session://plans/plan-frozen.md',
      approvedHandoff: { agent: 'general', label: 'Execute with General' },
    });
    expect(approvedExecutionOfferForAgent('sess', 'general')).toBeNull();
    expect(executionOfferRequiredSkillIds('sess', 'general')).toEqual([]);
  });

  it('rejects a mismatched approved handoff target or frozen URI', () => {
    mocks.planRead.mockReturnValue({
      status: 'approved',
      approvedHash: 'a'.repeat(64),
      frozenUri: 'session://plans/another-plan.md',
      approvedHandoff: { agent: 'general', label: 'Execute with General' },
    });
    expect(approvedExecutionOfferForAgent('sess', 'general')).toBeNull();
    mocks.planRead.mockReturnValue({
      status: 'approved',
      approvedHash: 'a'.repeat(64),
      frozenUri: 'session://plans/plan-frozen.md',
      approvedHandoff: { agent: 'analyzer', label: 'Execute with Analyzer' },
    });
    expect(approvedExecutionOfferForAgent('sess', 'general')).toBeNull();
    expect(executionOfferRequiredSkillIds('sess', 'general')).toEqual([]);
  });

  it('returns nothing when the plan is not approved', () => {
    mocks.planRead.mockReturnValue({ status: 'rejected', approvedHash: 'a'.repeat(64) });
    expect(executionOfferRequiredSkillIds('sess', 'general')).toEqual([]);
  });

  it('projects the original approved decision time without rewriting an overwritten offer', () => {
    const overwritten = { ...offer, approvedAt: 9999 };
    mocks.offerRead.mockReturnValue(overwritten);
    expect(approvedExecutionOfferForAgent('sess', 'general')?.approvedAt).toBe(1);
    expect(overwritten.approvedAt).toBe(9999);
  });

  it('stops applying a completed offer but permits an explicit new handoff of the same plan', () => {
    const oldId = '11111111-1111-4111-8111-111111111111';
    const newId = '22222222-2222-4222-8222-222222222222';
    mocks.offerRead.mockReturnValue({ ...offer, offerId: oldId });
    mocks.journalRead.mockReturnValue([{ status: 'complete', approvedExecutionCompletion: {
      offerId: oldId, planUri: offer.plan.uri, planHash: offer.plan.hash,
    } }]);
    expect(approvedExecutionOfferForAgent('sess', 'general')).toBeNull();
    mocks.offerRead.mockReturnValue({ ...offer, offerId: newId });
    expect(approvedExecutionOfferForAgent('sess', 'general')?.offerId).toBe(newId);
  });
});
