import { beforeEach, expect, it, vi } from 'vitest';
import { verifyApprovedPlanExit } from './approvedPlanExit';
const mock = vi.hoisted(() => ({ state: {} as Record<string, unknown>, offer: {} as Record<string, unknown>, read: vi.fn() }));
vi.mock('../sessions/PlanReviewStateStore', () => ({ planReviewStateStore: { read: () => mock.state } }));
vi.mock('../sessions/StorageAdapter', () => ({ storageAdapter: { executionOffers: { read: () => mock.offer } } }));
vi.mock('../sessions/sessionPlanArtifact', () => ({ planArtifactWriter: { readMarkdown: mock.read } }));
const approved = { toolCallId: 'c', planId: 'p', frozenUri: 'session://plans/plan-p.md', hash: 'h', target: 'general' };
beforeEach(() => { vi.clearAllMocks(); mock.state = { status: 'approved', ownerTurnId: 't', planId: 'p', approvedHash: 'h', frozenUri: approved.frozenUri, approvedHandoff: { agent: 'general' } }; mock.offer = { plan: { hash: 'h', uri: approved.frozenUri }, targetAgentId: 'general' }; });
it('accepts only an owning frozen approval and actually verifies the frozen bytes', () => {
 expect(verifyApprovedPlanExit('s', 't', approved)).toBe(true); expect(mock.read).toHaveBeenCalledWith('s', approved.frozenUri, 'h');
 expect(verifyApprovedPlanExit('s', 't', null)).toBe(false);
});
it.each(['ownerTurnId', 'planId', 'approvedHash', 'frozenUri', 'status'])('refuses changed %s', key => {
 mock.state[key] = 'other'; expect(() => verifyApprovedPlanExit('s', 't', approved)).toThrow('PLAN_REVIEW_SCOPE_CHANGED');
});
it('refuses a changed offer and unreadable artifact', () => {
 mock.offer.targetAgentId = 'other'; expect(() => verifyApprovedPlanExit('s', 't', approved)).toThrow();
 mock.offer.targetAgentId = 'general'; mock.read.mockImplementationOnce(() => { throw new Error('HASH_MISMATCH'); });
 expect(() => verifyApprovedPlanExit('s', 't', approved)).toThrow('HASH_MISMATCH');
});
