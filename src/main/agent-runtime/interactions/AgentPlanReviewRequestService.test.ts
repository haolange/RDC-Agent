import { describe, expect, it, vi } from 'vitest';

vi.mock('../../sessions/StorageAdapter', () => ({
  storageAdapter: {
    readSession: () => ({ sessionId: 'sess', projectId: 'proj' }),
    getProjectById: () => ({ rootPath: null }),
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

describe('AgentPlanReviewRequestService', () => {
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
    expect(service.answer({
      sessionId: 'sess',
      turnId: 'turn-1',
      toolCallId: 'call-1',
      decision: { kind: 'reject', feedback: '   ' },
    })).toEqual({ success: false, error: 'Rejecting a plan requires non-empty feedback.' });
    expect(service.isPending('sess', 'turn-1', 'call-1')).toBe(true);
    service.cancelTurn('turn-1');
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(service.answer({ sessionId: 'sess', turnId: 'turn-1', toolCallId: 'call-1',
      decision: { kind: 'approve', handoff: planReview.handoffOptions[0] },
    }).success).toBe(false);
  });

  it('approves by freezing the plan and recording the handoff target', async () => {
    const events: SharedAgentEvent[] = [];
    const turnHandle = { approvedPlan: null } as TurnHandle;
    const writer = {
      freezeApprovedPlan: () => ({ uri: 'session://plans/plan-frozen.md', hash: 'b'.repeat(64) }),
    } as unknown as PlanArtifactWriter;
    const store = {
      markDecision: () => ({ status: 'approved' }),
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
    expect(service.answer({ sessionId: 'other-owner', turnId: 'turn-2', toolCallId: 'call-2',
      decision: { kind: 'approve', handoff: planReview.handoffOptions[0] },
    }).success).toBe(false);
    expect(service.answer({ sessionId: 'sess', turnId: 'turn-2', toolCallId: 'call-2',
      decision: { kind: 'approve', handoff: { label: 'wrong', agent: 'optimizer' } },
    }).success).toBe(false);
    expect(turnHandle.approvedPlan).toBeNull();
    expect(service.answer({
      sessionId: 'sess',
      turnId: 'turn-2',
      toolCallId: 'call-2',
      decision: { kind: 'approve', handoff: { label: '交给 General 执行', agent: 'general' } },
    })).toEqual({ success: true });
    await expect(pending).resolves.toContain('已冻结，本回合结束，等待用户点声明按钮。');
    expect(turnHandle.approvedPlan).toEqual({
      hash: 'b'.repeat(64),
      target: 'general',
      frozenUri: 'session://plans/plan-frozen.md',
      planId: 'plan-1',
    });
    expect(events[1]?.payload).toMatchObject({ kind: 'plan_review', status: 'approved' });
    expect(service.answer({ sessionId: 'sess', turnId: 'turn-2', toolCallId: 'call-2',
      decision: { kind: 'approve', handoff: planReview.handoffOptions[0] },
    }).success).toBe(false);
    expect(events).toHaveLength(2);
  });
});

it.each(['freeze', 'persist'])('does not publish authority when %s fails', async failure => {
  const turnHandle = { approvedPlan: null } as TurnHandle;
  const writer = { freezeApprovedPlan: () => { if (failure === 'freeze') throw new Error('disk failure'); return { uri: 'session://plans/plan-frozen.md', hash: 'a'.repeat(64) }; } } as unknown as PlanArtifactWriter;
  const store = { markDecision: () => { throw new Error('disk failure'); } } as unknown as PlanReviewStateStore;
  const service = new AgentPlanReviewRequestService(writer, store);
  const onEvent = vi.fn();
  const pending = service.request({ agentId: 'debugger', sessionId: 'sess', turnId: 'turn', toolCallId: 'call', planReview, turnHandle, onEvent, context: { runId: 'run', turnId: 'turn', sessionId: 'sess', agentId: 'debugger' } });
  expect(() => service.answer({ sessionId: 'sess', turnId: 'turn', toolCallId: 'call', decision: { kind: 'approve', handoff: planReview.handoffOptions[0] } })).toThrow('disk failure');
  expect(turnHandle.approvedPlan).toBeNull();
  expect(service.isPending('sess', 'turn', 'call')).toBe(true);
  expect(onEvent).toHaveBeenCalledTimes(1);
  service.cancelTurn('turn');
  await expect(pending).rejects.toThrow(/cancelled/);
});
