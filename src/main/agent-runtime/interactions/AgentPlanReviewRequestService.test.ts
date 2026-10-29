import { describe, expect, it, vi } from 'vitest';
const preflight = vi.hoisted(() => vi.fn());
vi.mock('../../sessions/handoffSkillCompatibility', () => ({ assertDeclaredHandoffSkillCompatibility: preflight }));

vi.mock('../../sessions/StorageAdapter', () => ({
  storageAdapter: {
    readSession: () => ({ sessionId: 'sess', projectId: 'proj' }),
    getProjectById: () => ({ rootPath: null }),
    sessions: { findSessionLocation: () => null },
    executionOffers: { write: vi.fn(), read: vi.fn(), clear: vi.fn() },
  },
}));
vi.mock('../../conversation/ConversationRoutePreflight', () => ({
  resolveEnabledAgentDefinition: () => ({
    handoffs: [{
      agent: 'general',
      label: '交给 General 执行',
      prompt: 'Execute the frozen plan.',
      send: true,
      requiredSkillIds: ['renderdoc-execution'],
    }],
  }),
}));

import type { AgentEvent as SharedAgentEvent } from '@shared/types/agentRuntime';
import type { ConversationPlanReview } from '@shared/types/planReview';
import { AgentPlanReviewRequestService } from './AgentPlanReviewRequestService';
import type { PlanArtifactWriter } from '../../sessions/sessionPlanArtifact';
import type { PlanReviewStateStore } from '../../sessions/PlanReviewStateStore';
import type { TurnHandle } from '../../workflow/debugger/TurnCoordinator';
import type { PlanTaskRequirement } from '@shared/types/taskExecution';

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

it('keeps incompatible approval pending without installing revisions or publishing qualification', async () => {
  const markDecision = vi.fn(); const install = vi.fn(); const onEvent = vi.fn();
  const writer = { freezeApprovedPlan: () => ({ uri: 'session://plans/frozen.md', hash: 'b'.repeat(64), taskRequirements: [] }) } as unknown as PlanArtifactWriter;
  const store = { cancelReview: () => false, markDecision } as unknown as PlanReviewStateStore;
  const service = new AgentPlanReviewRequestService(writer, store, install);
  const turnHandle = { approvedPlan: null } as TurnHandle;
  const pending = service.request({ agentId: 'planner', sessionId: 'sess', turnId: 'turn', toolCallId: 'call', planReview, turnHandle, onEvent, context: { sessionId: 'sess', turnId: 'turn' } });
  preflight.mockImplementationOnce(() => { throw new Error('TASK_EXECUTION_REQUIREMENTS: document-method missing'); });
  await expect(service.answer({ sessionId: 'sess', turnId: 'turn', toolCallId: 'call', decision: { kind: 'approve', handoff: planReview.handoffOptions[0] } })).rejects.toThrow('document-method');
  expect(markDecision).not.toHaveBeenCalled(); expect(install).not.toHaveBeenCalled();
  expect(turnHandle.approvedPlan).toBeNull(); expect(onEvent).toHaveBeenCalledTimes(1);
  expect(service.isPending('sess', 'turn', 'call')).toBe(true);
  service.cancelTurn('turn'); await expect(pending).rejects.toThrow('cancelled');
});

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
  it('rejects empty feedback and keeps the request pending', async () => {
    const service = new AgentPlanReviewRequestService();
    const pending = service.request({
      agentId: 'debugger',
      sessionId: 'sess',
      turnId: 'turn-1',
      toolCallId: 'call-1',
      planReview,
      context: { runId: 'run', turnId: 'turn-1', sessionId: 'sess', agentId: 'debugger' },
    });
    expect(await service.answer({
      sessionId: 'sess',
      turnId: 'turn-1',
      toolCallId: 'call-1',
      decision: { kind: 'reject', feedback: '   ' },
    })).toEqual({ success: false, error: 'Rejecting a plan requires non-empty feedback.' });
    expect(service.isPending('sess', 'turn-1', 'call-1')).toBe(true);
    service.cancelTurn('turn-1');
    await expect(pending).rejects.toThrow(/cancelled/);
    expect((await service.answer({ sessionId: 'sess', turnId: 'turn-1', toolCallId: 'call-1',
      decision: { kind: 'approve', handoff: planReview.handoffOptions[0] },
    })).success).toBe(false);
  });

  it('approves by freezing the plan and recording the handoff target', async () => {
    const events: SharedAgentEvent[] = [];
    const turnHandle = { approvedPlan: null } as TurnHandle;
    const writer = {
      freezeApprovedPlan: () => ({ uri: 'session://plans/plan-frozen.md', hash: 'b'.repeat(64), taskRequirements: [] }),
    } as unknown as PlanArtifactWriter;
    const store = { cancelReview: () => false,
      markDecision: () => ({ status: 'approved', updatedAt: 1234 }),
    } as unknown as PlanReviewStateStore;
    const service = new AgentPlanReviewRequestService(writer, store);
    const pending = service.request({
      agentId: 'debugger',
      sessionId: 'sess',
      turnId: 'turn-2',
      toolCallId: 'call-2',
      planReview,
      turnHandle,
      context: { runId: 'run', turnId: 'turn-2', sessionId: 'sess', agentId: 'debugger' },
      onEvent: (event) => events.push(event),
    });
    expect((await service.answer({ sessionId: 'other-owner', turnId: 'turn-2', toolCallId: 'call-2',
      decision: { kind: 'approve', handoff: planReview.handoffOptions[0] },
    })).success).toBe(false);
    expect((await service.answer({ sessionId: 'sess', turnId: 'turn-2', toolCallId: 'call-2',
      decision: { kind: 'approve', handoff: { label: 'wrong', agent: 'optimizer' } },
    })).success).toBe(false);
    expect(turnHandle.approvedPlan).toBeNull();
    expect(await service.answer({
      sessionId: 'sess',
      turnId: 'turn-2',
      toolCallId: 'call-2',
      decision: { kind: 'approve', handoff: { label: '交给 General 执行', agent: 'general' } },
    })).toEqual({ success: true });
    await expect(pending).resolves.toContain('已冻结计划并确认声明交接。');
    expect(turnHandle.approvedPlan).toEqual({
      toolCallId: 'call-2',
      hash: 'b'.repeat(64),
      target: 'general',
      frozenUri: 'session://plans/plan-frozen.md',
      planId: 'plan-1',
    });
    expect(events[1]?.payload).toMatchObject({ kind: 'plan_review', status: 'approved' });
    expect((await service.answer({ sessionId: 'sess', turnId: 'turn-2', toolCallId: 'call-2',
      decision: { kind: 'approve', handoff: planReview.handoffOptions[0] },
    })).success).toBe(false);
    expect(events).toHaveLength(2);
  });
});

it.each(['freeze', 'persist'])('does not publish authority when %s fails', async failure => {
  const turnHandle = { approvedPlan: null } as TurnHandle;
  const writer = { freezeApprovedPlan: () => { if (failure === 'freeze') throw new Error('disk failure'); return { uri: 'session://plans/plan-frozen.md', hash: 'a'.repeat(64), taskRequirements: [] }; } } as unknown as PlanArtifactWriter;
  const store = { cancelReview: () => false, markDecision: () => { throw new Error('disk failure'); } } as unknown as PlanReviewStateStore;
  const service = new AgentPlanReviewRequestService(writer, store);
  const onEvent = vi.fn();
  const pending = service.request({ agentId: 'debugger', sessionId: 'sess', turnId: 'turn', toolCallId: 'call', planReview, turnHandle, onEvent, context: { runId: 'run', turnId: 'turn', sessionId: 'sess', agentId: 'debugger' } });
  await expect(service.answer({ sessionId: 'sess', turnId: 'turn', toolCallId: 'call', decision: { kind: 'approve', handoff: planReview.handoffOptions[0] } })).rejects.toThrow('disk failure');
  expect(turnHandle.approvedPlan).toBeNull();
  expect(service.isPending('sess', 'turn', 'call')).toBe(true);
  expect(onEvent).toHaveBeenCalledTimes(1);
  service.cancelTurn('turn');
  await expect(pending).rejects.toThrow(/cancelled/);
});

it.each(['finish', 'cancel', 'fail'])('joins the approved Task installation before publishing approval (%s)', async action => {
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  const task: PlanTaskRequirement = { taskId: 'task', revision: 2, replacesRevision: 1, previousRequirementHash: 'a'.repeat(64), subject: 'Work', description: '', completionRequirements: ['result'], blockedBy: [] };
  const writer = { freezeApprovedPlan: () => ({ uri: 'session://plans/frozen.md', hash: 'b'.repeat(64), taskRequirements: [task] }) } as unknown as PlanArtifactWriter;
  const markDecision = vi.fn(() => ({ updatedAt: 1234 }));
  const store = { cancelReview: () => false, markDecision } as unknown as PlanReviewStateStore;
  const install = vi.fn(async () => { await held; if (action === 'fail') throw new Error('TASK_PLAN_REVISION_CONFLICT'); });
  const service = new AgentPlanReviewRequestService(writer, store, install);
  const turnHandle = { approvedPlan: null } as TurnHandle;
  const pending = service.request({ agentId: 'debugger', sessionId: 'sess', turnId: 'turn', toolCallId: 'call', planReview, turnHandle, context: { sessionId: 'sess', turnId: 'turn', agentId: 'debugger' } });
  const pendingRejection = action === 'cancel' ? expect(pending).rejects.toThrow('cancelled') : undefined;
  const input = { sessionId: 'sess', turnId: 'turn', toolCallId: 'call', decision: { kind: 'approve' as const, handoff: planReview.handoffOptions[0] } };
  const first = service.answer(input);
  expect(markDecision).not.toHaveBeenCalled();
  expect(turnHandle.approvedPlan).toBeNull();
  expect(await service.answer(input)).toEqual({ success: false, error: 'Plan review answer is already committing.' });
  if (action === 'cancel') service.cancelTurn('turn');
  finish();
  if (action === 'fail') {
    await expect(first).rejects.toThrow('TASK_PLAN_REVISION_CONFLICT');
    expect(markDecision).not.toHaveBeenCalled();
    service.cancelTurn('turn'); await expect(pending).rejects.toThrow('cancelled');
  } else if (action === 'cancel') {
    expect((await first).success).toBe(false); await pendingRejection;
    expect(markDecision).not.toHaveBeenCalled();
  } else {
    expect(await first).toEqual({ success: true });
    expect(markDecision).toHaveBeenCalledOnce();
    await expect(pending).resolves.toContain('approved');
  }
});
