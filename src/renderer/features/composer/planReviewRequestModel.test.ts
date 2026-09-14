import { describe, expect, it } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import { findPendingPlanReview } from './planReviewRequestModel';

const planReview = {
  planId: 'plan-1',
  revision: 1,
  uri: 'session://plans/plan.md',
  hash: 'a'.repeat(64),
  title: 'Investigate drop',
  summary: ['Check GPU'],
  sections: [{ heading: 'Goal', body: 'Find it.' }],
  status: 'awaiting' as const,
  handoffOptions: [{ label: '交给 General 执行', agent: 'general' }],
};

describe('findPendingPlanReview', () => {
  it('returns the awaiting plan_artifact call on a streaming assistant message', () => {
    const messages: ConversationMessage[] = [{
      id: 'm1',
      turnId: 'turn-1',
      sessionId: 'sess',
      projectId: 'p',
      role: 'assistant',
      status: 'streaming',
      content: '',
      createdAt: 2,
      workTrace: {
        summary: '',
        status: 'running',
        updatedAt: 2,
        blocks: [{
          id: 'runtime-plan-review',
          kind: 'plan_review',
          title: 'Plan',
          status: 'running',
          startedAt: 2,
          toolCalls: [{
            id: 'call-1',
            toolName: 'plan_artifact',
            status: 'running',
            startedAt: 2,
            planReview,
          }],
        }],
      },
    }];
    expect(findPendingPlanReview(messages)).toMatchObject({
      sessionId: 'sess',
      turnId: 'turn-1',
      toolCallId: 'call-1',
      planReview: { planId: 'plan-1' },
    });
  });

  it('ignores completed or superseded reviews', () => {
    const messages: ConversationMessage[] = [{
      id: 'm1',
      turnId: 'turn-1',
      sessionId: 'sess',
      projectId: 'p',
      role: 'assistant',
      status: 'streaming',
      content: '',
      createdAt: 2,
      workTrace: {
        summary: '',
        status: 'running',
        updatedAt: 2,
        blocks: [{
          id: 'runtime-plan-review',
          kind: 'plan_review',
          title: 'Plan',
          status: 'running',
          startedAt: 2,
          toolCalls: [{
            id: 'call-1',
            toolName: 'plan_artifact',
            status: 'running',
            startedAt: 2,
            planReview: { ...planReview, status: 'approved' },
          }],
        }],
      },
    }];
    expect(findPendingPlanReview(messages)).toBeNull();
  });
});
