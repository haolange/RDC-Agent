import { createHash } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { sessionRevisions } from '../../sessions/store/SessionRevisionRegistry';
import { readReferencedPlan } from '../../sessions/run/sessionPlanReference';
import { AgentPlanReviewRequestService } from './AgentPlanReviewRequestService';
import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationPlanReview } from '@shared/types/planReview';
import type { PlanReviewStateDocument } from '../../sessions/run/PlanReviewStateStore';

const fixture = vi.hoisted(() => ({
  state: null as PlanReviewStateDocument | null,
  history: [] as ConversationMessage[],
  content: 'A verified plan',
  failWrite: false,
  freeze: vi.fn(),
  offer: vi.fn(),
  readOffer: vi.fn(),
  session: vi.fn(),
}));
vi.mock('../../sessions/store/sessionStores', () => ({
  sessionRecordStore: {
    findSessionLocation: () => ({ sessionPath: '/session' }),
    readSession: () => ({ sessionId: 'session', projectId: 'project' }),
    updateSession: (_id: string, patch: object) => {
      fixture.session(patch);
      return { sessionId: 'session', projectId: 'project', ...patch };
    },
  },
  storageIo: {
    readJson: () => fixture.state,
    writeJsonAtomic: (_path: string, state: PlanReviewStateDocument) => {
      if (fixture.failWrite) throw new Error('disk failed');
      fixture.state = structuredClone(state);
    },
  },
  conversationHistoryStore: { readConversationHistory: () => fixture.history, readConversationBranchState: () => null },
  projectWorkspaceStore: { getProjectById: () => ({ rootPath: '/project' }) },
  executionOfferStore: { clear: vi.fn(), read: fixture.readOffer, write: fixture.offer },
}));
vi.mock('../../hooks/runtimeHookDispatch', () => ({ dispatchRuntimeHooks: async () => true }));
vi.mock('./sessionModelGate', () => ({ assertSessionModelAndControls: async () => undefined }));
vi.mock('../../sessions/run/sessionPlanArtifact', () => ({
  planArtifactWriter: {
    readMarkdown: (_session: string, uri: string, hash: string) => {
      if (createHash('sha256').update(fixture.content).digest('hex') !== hash) throw new Error('PLAN_HASH_MISMATCH');
      return { markdown: fixture.content, hash, uri };
    },
    stageFrozenPlan: (...args: unknown[]) => fixture.freeze(...args),
    writeFrozenPlan: vi.fn(),
    discardFrozenPlan: vi.fn(),
  },
}));
vi.mock('./applyDeclaredHandoff', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./applyDeclaredHandoff')>()),
  assertDeclaredHandoffForPlan: vi.fn(() => ({
    agent: 'general',
    label: 'Execute',
    prompt: 'Continue',
    send: true,
    requiredSkillIds: [],
    requiredToolIds: [],
  })),
}));
const hash = createHash('sha256').update('A verified plan').digest('hex');
const plan: ConversationPlanReview = {
  planId: 'plan',
  revision: 1,
  uri: 'session://plans/plan.md',
  hash,
  title: 'Plan',
  summary: [],
  sections: [],
  status: 'cancelled',
  handoffOptions: [{ agent: 'general', label: 'Execute' }],
};
const reference = {
  sessionId: 'session',
  planId: plan.planId,
  revision: plan.revision,
  uri: plan.uri,
  expectedHash: hash,
};
const approve = (reviewId: string, sessionId = 'session') => ({
  sessionId,
  reviewId,
  decision: { kind: 'approve' as const, handoff: plan.handoffOptions[0] },
  expectedPlanHash: hash,
  model: { providerId: 'p', modelId: 'm' },
  controls: { reasoningLevel: 'high' as const, fastModel: false, maxContextMode: false },
  baseRevision: sessionRevisions.revisionOf('session'),
});
beforeEach(() => {
  vi.clearAllMocks();
  fixture.failWrite = false;
  fixture.content = 'A verified plan';
  fixture.state = {
    planId: 'plan',
    ownerTurnId: 'turn',
    revision: 1,
    status: 'awaiting',
    updatedAt: 1,
  };
  fixture.history = [
    {
      id: 'message',
      sessionId: 'session',
      projectId: 'project',
      turnId: 'turn',
      agentId: 'debugger',
      role: 'assistant',
      status: 'stopped',
      content: '',
      createdAt: 1,
      workTrace: {
        status: 'stopped',
        updatedAt: 1,
        blocks: [
          {
            id: 'block',
            title: 'Plan',
            kind: 'plan_review',
            status: 'cancelled',
            startedAt: 1,
            toolCalls: [
              {
                id: 'call',
                toolName: 'plan_artifact',
                status: 'cancelled',
                startedAt: 1,
                planReview: structuredClone(plan),
              },
            ],
          },
        ],
      },
    },
  ];
  fixture.freeze.mockReturnValue({
    uri: 'session://plans/plan-frozen.md',
    markdown: 'A verified plan',
    hash,
    taskRequirements: [],
  });
});
it('restores awaiting ownership after restart without reviving the old turn and approves once', async () => {
  fixture.history[0].workTrace!.blocks[0].toolCalls[0].planReview!.handoffOptions = [
    { agent: 'general', label: 'Execute', labelTranslations: { 'zh-CN': '执行' } },
  ];
  const service = new AgentPlanReviewRequestService();
  const projection = service.projection('session');
  expect(projection.review).toMatchObject({ recovered: true, agentId: 'debugger' });
  expect(projection.review?.planReview.handoffOptions[0].labelTranslations).toEqual({ 'zh-CN': '执行' });
  const request = approve(projection.review!.reviewId);
  await expect(service.answer({ ...request, sessionId: 'other' })).rejects.toMatchObject({
    code: 'PLAN_SESSION_DENIED',
  });
  await expect(service.answer(request)).resolves.toMatchObject({
    decision: 'approve',
    handoff: { prompt: 'Continue', send: true },
  });
  await expect(service.answer(request)).rejects.toMatchObject({ code: 'PLAN_REVIEW_SCOPE_CHANGED' });
  expect(fixture.freeze).toHaveBeenCalledOnce();
  expect(fixture.offer).toHaveBeenCalledOnce();
  expect(fixture.session).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ agentId: 'general' }));
  expect(fixture.state?.status).toBe('approved');
  expect(fixture.history[0].status).toBe('stopped');
  expect(fixture.state?.approvedHandoff).toEqual({ agent: 'general', label: 'Execute' });
  expect(readReferencedPlan({ ...reference, uri: fixture.state!.frozenUri! })).toMatchObject({
    agentId: 'debugger',
    hash,
  });
  expect(fixture.history[0].workTrace!.blocks[0].toolCalls[0].planReview?.status).toBe('cancelled');
});
it('keeps Stop durable, reopens only explicitly, and rejects an earlier review identity', async () => {
  const service = new AgentPlanReviewRequestService();
  const first = service.projection('session').review!;
  expect(service.cancel('session', first.reviewId)).toEqual({ success: true });
  expect(service.projection('session')).toMatchObject({ review: null, recoverable: reference });
  const second = service.reopen(reference).review!;
  expect(second.reviewId).not.toBe(first.reviewId);
  await expect(
    service.answer({ sessionId: 'session', reviewId: first.reviewId, decision: { kind: 'reject', feedback: 'old' } }),
  ).rejects.toMatchObject({ code: 'PLAN_REVIEW_SCOPE_CHANGED' });
  const result = await service.answer({
    sessionId: 'session',
    reviewId: second.reviewId,
    decision: { kind: 'reject', feedback: 'Change scope' },
  });
  expect(result).toMatchObject({
    decision: 'reject',
    replan: { agentId: 'debugger', source: reference, feedback: 'Change scope' },
  });
  expect(service.projection('session').review).toBeNull();
  expect(fixture.state?.status).toBe('rejected');
});
it.each(['approved', 'rejected', 'superseded'] as const)('does not restore %s state', (status) => {
  fixture.state!.status = status;
  expect(new AgentPlanReviewRequestService().projection('session').review).toBeNull();
});
it('projects an approved but unsent handoff after restart without reopening review or sending', () => {
  fixture.state = {
    ...fixture.state!,
    status: 'approved',
    approvedHash: hash,
    frozenUri: 'session://plans/frozen.md',
    approvedHandoff: { agent: 'general', label: 'Execute' },
    updatedAt: 10,
  };
  fixture.readOffer.mockReturnValue({
    schemaVersion: '1',
    sourceAgentId: 'debugger',
    targetAgentId: 'general',
    plan: { uri: fixture.state.frozenUri, hash },
    label: 'Execute',
    prompt: 'Continue',
    requiredSkillIds: [],
    requiredToolIds: [],
    approvedAt: 10,
  });
  const projection = new AgentPlanReviewRequestService().projection('session');
  expect(projection.review).toBeNull();
  expect(projection.approvedHandoff).toMatchObject({ agent: 'general', label: 'Execute', planHash: hash });
  expect(fixture.state.status).toBe('approved');
  expect(fixture.offer).not.toHaveBeenCalled();
});
it.each(['hash', 'owner', 'branch', 'revision'])('fails closed after %s changes', async (change) => {
  const service = new AgentPlanReviewRequestService();
  const review = service.projection('session').review!;
  if (change === 'hash') fixture.content = 'Changed';
  if (change === 'owner') fixture.state!.ownerTurnId = 'other';
  if (change === 'branch') fixture.history[0].branchId = 'other';
  if (change === 'revision') fixture.state!.revision = 2;
  await expect(service.answer(approve(review.reviewId))).rejects.toThrow();
  expect(fixture.offer).not.toHaveBeenCalled();
});
it('refuses reopening during another request and reports persistence failure without approval', async () => {
  fixture.state!.status = 'cancelled';
  const service = new AgentPlanReviewRequestService();
  service.setBusyChecker(() => true);
  expect(() => service.reopen(reference)).toThrow(/BUSY/);
  service.setBusyChecker(() => false);
  const review = service.reopen(reference).review!;
  fixture.failWrite = true;
  await expect(service.answer(approve(review.reviewId))).rejects.toThrow('disk failed');
  expect(fixture.offer).not.toHaveBeenCalled();
  expect(fixture.state?.status).toBe('awaiting');
});
