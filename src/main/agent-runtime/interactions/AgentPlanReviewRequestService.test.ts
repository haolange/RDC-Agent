import { describe, expect, it, vi } from 'vitest';
const transaction = vi.hoisted(() => vi.fn());
vi.mock('./PlanApprovalTransaction', () => ({ runPlanApprovalTransaction: transaction }));
vi.mock('../../sessions/store/sessionStores', () => ({
  sessionRecordStore: { findSessionLocation: () => null },
  executionOfferStore: { clear: vi.fn() },
}));

import { AgentPlanReviewRequestService } from './AgentPlanReviewRequestService';
import type { AgentEvent as SharedAgentEvent } from '@shared/types/agentRuntime';
import type { ConversationPlanReview, PlanApprovalRequest } from '@shared/types/planReview';
import type { PlanReviewStateStore } from '../../sessions/run/PlanReviewStateStore';
import type { TurnHandle } from '../orchestration/TurnCoordinator';
import type { PlanApprovalDeps } from './PlanApprovalTransaction';

const planReview: ConversationPlanReview = {
  planId: 'plan-1',
  revision: 1,
  uri: 'session://plans/plan.md',
  hash: 'a'.repeat(64),
  title: 'Investigate drop',
  summary: ['Check GPU'],
  sections: [{ heading: 'Goal', body: 'Find the drop.' }],
  status: 'awaiting',
  handoffOptions: [{ label: '交给 General 执行', agent: 'general' }],
};
const committed = {
  frozen: { uri: 'session://plans/plan-frozen.md', hash: 'b'.repeat(64) },
  planState: {},
  session: { record: { sessionId: 'sess', agentId: 'general' }, revision: { epoch: 'run-1', n: 4 } },
  handoff: { label: '交给 General 执行', agent: 'general', prompt: 'Execute the frozen plan.', send: true },
};

function approval(service: AgentPlanReviewRequestService, sessionId = 'sess'): PlanApprovalRequest {
  return {
    sessionId, reviewId: service.projection('sess').review?.reviewId ?? 'expired',
    decision: { kind: 'approve', handoff: planReview.handoffOptions[0] }, expectedPlanHash: planReview.hash,
    model: { providerId: 'p', modelId: 'm' }, controls: { reasoningLevel: 'high', fastModel: false, maxContextMode: false },
    baseRevision: { epoch: 'run-1', n: 3 },
  };
}

function open(service: AgentPlanReviewRequestService, turnHandle?: TurnHandle, onEvent?: (event: SharedAgentEvent) => void) {
  return service.request({ agentId: 'debugger', sessionId: 'sess', turnId: 'turn', toolCallId: 'call', planReview, turnHandle, onEvent,
    context: { runId: 'run', turnId: 'turn', sessionId: 'sess', agentId: 'debugger' } });
}

describe('AgentPlanReviewRequestService', () => {
  it.each([false, true])('persists exact review cancellation including already-aborted=%s', async alreadyAborted => {
    const cancelReview = vi.fn(() => true);
    const store = { cancelReview } as unknown as PlanReviewStateStore;
    const service = new AgentPlanReviewRequestService(undefined, store);
    const controller = new AbortController();
    const events: SharedAgentEvent[] = [];
    if (alreadyAborted) controller.abort();
    const pending = service.request({ agentId: 'custom-planner', sessionId: 'sess', turnId: 'turn-c',
      toolCallId: 'call-c', planReview, signal: controller.signal,
      context: { sessionId: 'sess', turnId: 'turn-c', agentId: 'custom-planner' }, onEvent: event => events.push(event) });
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    if (!alreadyAborted) controller.abort();
    await rejected;
    service.cancelTurn('turn-c');
    expect(cancelReview).toHaveBeenCalledExactlyOnceWith('sess', 'turn-c', 'plan-1', 1);
    expect(events.at(-1)?.payload).toMatchObject({ status: 'cancelled', planReview: { status: 'cancelled' } });
    expect(service.isPending('sess', 'turn-c', 'call-c')).toBe(false);
  });

  it('rejects with feedback into the same loop and refuses to approve the answered review', async () => {
    const markRejected = vi.fn();
    const service = new AgentPlanReviewRequestService(undefined, { cancelReview: () => false, markRejected } as unknown as PlanReviewStateStore);
    const pending = open(service);
    const reviewId = service.projection('sess').review!.reviewId;
    const result = await service.answer({ sessionId: 'sess', reviewId, decision: { kind: 'reject', feedback: ' Narrow it. ' } });
    expect(result).toMatchObject({ decision: 'reject', planReview: { decision: { reviewId, kind: 'reject' } } });
    expect(markRejected).toHaveBeenCalledExactlyOnceWith('sess', { turnId: 'turn', planId: 'plan-1', revision: 1 });
    await expect(pending).resolves.toBe('rejected\nfeedback: Narrow it.');
    await expect(service.answer({ ...approval(service), reviewId })).rejects.toMatchObject({ code: 'PLAN_REVIEW_SCOPE_CHANGED' });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('publishes an approval only after the transaction committed it, and answers with the committed record', async () => {
    transaction.mockReset().mockResolvedValue(committed);
    const events: SharedAgentEvent[] = [];
    const turnHandle = { approvedPlan: null } as TurnHandle;
    const service = new AgentPlanReviewRequestService();
    const pending = open(service, turnHandle, (event) => events.push(event));
    await expect(service.answer(approval(service, 'other-owner'))).rejects.toMatchObject({ code: 'PLAN_SESSION_DENIED' });
    const request = approval(service);
    const result = await service.answer(request);

    expect(transaction).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      sessionId: 'sess', turnId: 'turn', sourceAgentId: 'debugger', handoff: request.decision.handoff,
      expectedPlanHash: request.expectedPlanHash, model: request.model, controls: request.controls, baseRevision: request.baseRevision,
    }), expect.any(Object));
    expect(result).toEqual({ decision: 'approve', session: committed.session,
      planReview: expect.objectContaining({ decision: { reviewId: request.reviewId, kind: 'approve' } }),
      handoff: { prompt: 'Execute the frozen plan.', send: true } });
    await expect(pending).resolves.toContain('已冻结计划并确认声明交接。');
    expect(turnHandle.approvedPlan).toEqual({ toolCallId: 'call', hash: committed.frozen.hash, target: 'general',
      frozenUri: committed.frozen.uri, planId: 'plan-1' });
    expect(events[1]?.payload).toMatchObject({ kind: 'plan_review', status: 'approved' });
    await expect(service.answer(request)).rejects.toMatchObject({ code: 'PLAN_REVIEW_SCOPE_CHANGED' });
    expect(events).toHaveLength(2);
  });

  it('keeps a failed approval pending without publishing anything', async () => {
    transaction.mockReset().mockRejectedValue(Object.assign(new Error('HOOK_DENIED: agent.before-handoff'), { code: 'HOOK_DENIED' }));
    const turnHandle = { approvedPlan: null } as TurnHandle;
    const onEvent = vi.fn();
    const service = new AgentPlanReviewRequestService(undefined, { cancelReview: () => false } as unknown as PlanReviewStateStore);
    const pending = open(service, turnHandle, onEvent);
    await expect(service.answer(approval(service))).rejects.toMatchObject({ code: 'HOOK_DENIED' });
    expect(turnHandle.approvedPlan).toBeNull();
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(service.isPending('sess', 'turn', 'call')).toBe(true);
    service.cancelTurn('turn');
    await expect(pending).rejects.toThrow(/cancelled/);
  });

  it('refuses a second answer while the first commits, and tells the transaction once the review was cancelled', async () => {
    let finish!: () => void;
    let deps!: PlanApprovalDeps;
    transaction.mockReset().mockImplementation(async (_input, received: PlanApprovalDeps) => {
      deps = received;
      await new Promise<void>((resolve) => { finish = resolve; });
      if (!received.isCurrent()) throw Object.assign(new Error('PLAN_REVIEW_SCOPE_CHANGED'), { code: 'PLAN_REVIEW_SCOPE_CHANGED' });
      return committed;
    });
    const service = new AgentPlanReviewRequestService(undefined, { cancelReview: () => true } as unknown as PlanReviewStateStore);
    const pending = open(service);
    const request = approval(service);
    const first = service.answer(request);
    await vi.waitFor(() => expect(deps).toBeDefined());
    await expect(service.answer(request)).rejects.toMatchObject({ code: 'PLAN_REVIEW_BUSY' });
    expect(deps.isCurrent()).toBe(true);
    service.cancelTurn('turn');
    expect(deps.isCurrent()).toBe(false);
    await expect(pending).rejects.toThrow(/cancelled/);
    finish();
    await expect(first).rejects.toMatchObject({ code: 'PLAN_REVIEW_SCOPE_CHANGED' });
  });
});
