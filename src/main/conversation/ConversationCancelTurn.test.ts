import { describe, expect, it } from 'vitest';
import type { AgentEvent as SharedAgentEvent } from '@shared/types/agentRuntime';
import { translateCoreToSharedAgentEvent } from '../agent-runtime/AgentEventBridge';
import { agentToolApprovalRequestService } from '../agent-runtime/permissions/AgentToolApprovalRequestService';
import { agentUserInputRequestService } from '../agent-runtime/interactions/AgentUserInputRequestService';
import { agentPlanReviewRequestService } from '../agent-runtime/interactions/AgentPlanReviewRequestService';

const eventContext = {
  runId: 'run-cancel-test',
  turnId: 'turn-cancel-test',
  sessionId: 'session-cancel-test',
  agentId: 'debugger' as const,
};

describe('cancel turn stability', () => {
  it('emits cancelled approval.answered when a pending tool approval is cancelled', async () => {
    const events: SharedAgentEvent[] = [];
    const turnId = 'turn-approval-cancel';
    const requestPromise = agentToolApprovalRequestService.request({
      agentId: 'debugger',
      turnId,
      toolCallId: 'tool-shell',
      toolName: 'shell',
      reason: 'Run command?',
      risk: 'medium',
      context: eventContext,
      onEvent: (event) => events.push(event),
    });

    agentToolApprovalRequestService.cancelTurn(turnId);

    await expect(requestPromise).rejects.toThrow(/cancelled/i);
    expect(events.map((event) => event.type)).toEqual([
      'approval.requested',
      'approval.answered',
    ]);
    expect(events[1]?.payload).toMatchObject({
      status: 'cancelled',
      kind: 'tool',
      toolCallId: 'tool-shell',
    });
  });

  it('emits cancelled approval.answered when a pending ask_user request is cancelled', async () => {
    const events: SharedAgentEvent[] = [];
    const turnId = 'turn-ask-user-cancel';
    const requestPromise = agentUserInputRequestService.request({
      agentId: 'debugger',
      turnId,
      toolCallId: 'tool-ask-user',
      questions: [{
        questionId: 'choice',
        prompt: 'Which option?',
        options: [
          { optionId: 'a', label: 'A' },
          { optionId: 'b', label: 'B' },
        ],
        allowFreeform: true,
      }],
      context: eventContext,
      onEvent: (event) => events.push(event),
    });

    agentUserInputRequestService.cancelTurn(turnId);

    await expect(requestPromise).rejects.toThrow(/cancelled/i);
    expect(events.map((event) => event.type)).toEqual([
      'approval.requested',
      'approval.answered',
    ]);
    expect(events[1]?.payload).toMatchObject({
      status: 'cancelled',
      kind: 'ask_user',
      toolCallId: 'tool-ask-user',
    });
  });

  it('emits cancelled approval.answered when a pending plan review is cancelled', async () => {
    const events: SharedAgentEvent[] = [];
    const turnId = 'turn-plan-review-cancel';
    const requestPromise = agentPlanReviewRequestService.request({
      agentId: 'debugger',
      sessionId: 'session-cancel-test',
      turnId,
      toolCallId: 'tool-plan',
      planReview: {
        planId: 'plan-1',
        revision: 1,
        uri: 'session://plans/plan.md',
        hash: 'a'.repeat(64),
        title: 'Plan',
        summary: ['One'],
        sections: [],
        status: 'awaiting',
        handoffOptions: [{ label: '交给 General 执行', agent: 'general' }],
      },
      context: eventContext,
      onEvent: (event) => events.push(event),
    });

    agentPlanReviewRequestService.cancelTurn(turnId);

    await expect(requestPromise).rejects.toThrow(/cancelled/i);
    expect(events[1]?.payload).toMatchObject({
      status: 'cancelled',
      kind: 'plan_review',
      toolCallId: 'tool-plan',
    });
  });

  it('translates recovery diagnostic core events for ConversationService projection', () => {
    const shared = translateCoreToSharedAgentEvent({
      type: 'diagnostic',
      code: 'error_recovery_retry',
      severity: 'info',
      message: 'provider 错误，正在重试（第 1 次）',
      phase: 'started',
    }, eventContext);

    expect(shared).toMatchObject({
      type: 'diagnostic',
      payload: {
        code: 'error_recovery_retry',
        phase: 'started',
        message: 'provider 错误，正在重试（第 1 次）',
      },
    });
  });
});
