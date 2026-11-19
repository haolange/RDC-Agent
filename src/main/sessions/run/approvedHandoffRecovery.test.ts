import { beforeEach, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ExecutionOffer } from '@shared/types/executionOffer';
import type { PlanReviewStateDocument } from '@shared/types/planReview';

const f = vi.hoisted(() => ({ history: [] as ConversationMessage[], offer: null as ExecutionOffer | null,
  source: { ownerSessionId: 's', turnId: 'turn', agentId: 'debugger', markdown: '# Plan' },
  declaration: { agent: 'general', label: 'Execute', prompt: 'Execute the plan.', send: true,
    requiredSkillIds: ['method'], requiredToolIds: ['read'] } }));
vi.mock('../store/StorageAdapter', () => ({ storageAdapter: {
  readConversationHistory: () => f.history, readConversationBranchState: () => null,
  readSession: () => ({ sessionId: 's', projectId: 'p' }), getProjectById: () => ({ rootPath: '/p' }),
  executionOffers: { read: () => f.offer },
} }));
vi.mock('./sessionPlanReference', () => ({ readReferencedPlan: () => f.source }));
vi.mock('../../conversation/applyDeclaredHandoff', () => ({ assertDeclaredHandoffForPlan: () => f.declaration }));
import { resolveApprovedHandoff } from './approvedHandoffRecovery';

const approval: PlanReviewStateDocument = { schemaVersion: '1', planId: 'plan', revision: 1, ownerTurnId: 'turn',
  status: 'approved', approvedHash: 'a'.repeat(64), frozenUri: 'session://plans/frozen.md',
  approvedHandoff: { agent: 'general', label: 'Execute' }, updatedAt: 10 };
beforeEach(() => {
  f.offer = { schemaVersion: '1', sourceAgentId: 'debugger', targetAgentId: 'general', label: 'Execute',
    prompt: 'Execute the plan.', plan: { uri: approval.frozenUri!, hash: approval.approvedHash! },
    requiredSkillIds: ['method'], requiredToolIds: ['read'], approvedAt: 10 };
  f.source = { ownerSessionId: 's', turnId: 'turn', agentId: 'debugger', markdown: '# Plan' };
  f.declaration = { agent: 'general', label: 'Execute', prompt: 'Execute the plan.', send: true,
    requiredSkillIds: ['method'], requiredToolIds: ['read'] };
  f.history = [{ id: 'm', sessionId: 's', projectId: 'p', turnId: 'turn', agentId: 'debugger', role: 'assistant', status: 'stopped',
    content: '', createdAt: 1, workTrace: { status: 'stopped', updatedAt: 1, blocks: [{ id: 'b', kind: 'plan_review',
      title: 'Plan', status: 'cancelled', startedAt: 1, toolCalls: [{ id: 'c', toolName: 'plan_artifact', status: 'cancelled',
        startedAt: 1, planReview: { planId: 'plan', revision: 1, hash: 'a'.repeat(64), uri: 'session://plans/plan.md',
          title: 'Plan', summary: [], sections: [], status: 'cancelled', handoffOptions: [] } }] }] } }];
});

it('offers an explicit continuation for an approved, unexecuted plan without altering its stopped history', () => {
  expect(resolveApprovedHandoff('s', approval)).toMatchObject({ agent: 'general', label: 'Execute', planHash: approval.approvedHash });
  expect(f.history[0]?.status).toBe('stopped');
});

it.each(['state', 'hash', 'target', 'owner', 'branch', 'method', 'request'] as const)(
  'does not offer recovery when %s no longer proves the approved action', change => {
    const state = structuredClone(approval);
    if (change === 'state') state.status = 'cancelled';
    if (change === 'hash') f.offer!.plan.hash = 'b'.repeat(64);
    if (change === 'target') f.offer!.targetAgentId = 'other';
    if (change === 'owner') f.source.turnId = 'other';
    if (change === 'branch') f.history[0]!.branchId = 'other';
    if (change === 'method') f.declaration.requiredSkillIds = ['different'];
    if (change === 'request') f.history.push({ id: 'u', sessionId: 's', projectId: 'p', turnId: 'new', role: 'user', status: 'complete', content: 'Continue', createdAt: 10 });
    expect(resolveApprovedHandoff('s', state)).toBeNull();
  },
);
