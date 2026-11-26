import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePlanReference } from './planReferenceResolution';
import type { ConversationMessage } from '@shared/types/conversation';
import type { RecoverableApprovedHandoff } from '@shared/types/planReview';
import type { PlanReviewStateDocument } from '../sessions/run/PlanReviewStateStore';

const hash = 'a'.repeat(64);
const f = vi.hoisted(() => ({
  handoff: null as RecoverableApprovedHandoff | null,
  state: null as PlanReviewStateDocument | null,
  history: [] as ConversationMessage[],
  source: { ownerSessionId: 's', turnId: 'turn', agentId: 'debugger', markdown: '# Plan' },
}));
vi.mock('../agent-runtime/interactions/approvedHandoffRecovery', () => ({ resolveApprovedHandoff: () => f.handoff }));
vi.mock('../sessions/run/PlanReviewStateStore', () => ({ planReviewStateStore: { read: () => f.state } }));
vi.mock('../sessions/run/sessionPlanReference', () => ({ readReferencedPlan: () => f.source }));
vi.mock('../sessions/store/sessionStores', () => ({
  conversationHistoryStore: { readConversationHistory: () => f.history, readConversationBranchState: () => null },
}));

const execute = { intent: 'execute' as const, sessionId: 's', planId: 'plan', revision: 2, expectedHash: hash };

beforeEach(() => {
  f.handoff = {
    agent: 'general',
    label: 'Execute',
    labelTranslations: { 'zh-CN': '执行计划' },
    prompt: 'Execute the plan.',
    send: true,
    planId: 'plan',
    revision: 2,
    planHash: hash,
    planUri: 'session://plans/frozen.md',
    planTitle: 'Find the draw',
  };
  f.state = { schemaVersion: '1', planId: 'plan', revision: 2, ownerTurnId: 'turn', status: 'rejected', updatedAt: 1 };
  f.history = [
    {
      id: 'm',
      sessionId: 's',
      projectId: 'p',
      turnId: 'turn',
      agentId: 'debugger',
      role: 'assistant',
      content: '',
      createdAt: 1,
      workTrace: {
        status: 'complete',
        updatedAt: 1,
        blocks: [
          {
            id: 'b',
            kind: 'plan_review',
            title: 'Plan',
            status: 'complete',
            startedAt: 1,
            toolCalls: [
              {
                id: 'c',
                toolName: 'plan_artifact',
                status: 'complete',
                startedAt: 1,
                planReview: {
                  planId: 'plan',
                  revision: 2,
                  hash,
                  uri: 'session://plans/plan.md',
                  title: 'Find the draw',
                  summary: [],
                  sections: [],
                  status: 'rejected',
                  handoffOptions: [],
                },
              },
            ],
          },
        ],
      },
    },
  ];
});

describe('plan references on user messages', () => {
  it('accepts the declared handoff prompt for the approved, unsent revision and records what it executes', () => {
    expect(
      resolvePlanReference({ request: execute, sessionId: 's', agentId: 'general', message: '  Execute the plan.\n' })
        .reference,
    ).toEqual({
      intent: 'execute',
      planId: 'plan',
      revision: 2,
      hash,
      uri: 'session://plans/frozen.md',
      title: 'Find the draw',
      agentId: 'general',
    });
  });

  it.each([
    ['another session', { sessionId: 'other' }, /PLAN_SESSION_DENIED/],
    ['a consumed or missing approval', { handoff: null }, /no approved, unsent plan handoff/],
    ['a changed revision', { request: { ...execute, expectedHash: 'b'.repeat(64) } }, /revision changed/],
    ['another Agent', { agentId: 'debugger' }, /targets another Agent/],
    ['a different message', { message: 'Do something else.' }, /declared handoff prompt/],
  ])('rejects an execution reference with %s', (_label, change, error) => {
    if ('handoff' in change) f.handoff = null;
    const input = { request: execute, sessionId: 's', agentId: 'general', message: 'Execute the plan.', ...change };
    expect(() => resolvePlanReference(input)).toThrow(error);
  });

  it('accepts a revision of the current rejected plan from its planner and returns the source material', () => {
    const request = {
      intent: 'revise' as const,
      sessionId: 's',
      planId: 'plan',
      revision: 2,
      uri: 'session://plans/plan.md',
      expectedHash: hash,
    };
    const result = resolvePlanReference({ request, sessionId: 's', agentId: 'debugger', message: 'Narrow the scope.' });
    expect(result.reference).toMatchObject({
      intent: 'revise',
      planId: 'plan',
      revision: 2,
      title: 'Find the draw',
      agentId: 'debugger',
    });
    expect(result.revisionSource?.markdown).toBe('# Plan');
    f.state = { ...f.state!, status: 'approved' };
    expect(() =>
      resolvePlanReference({ request, sessionId: 's', agentId: 'debugger', message: 'Narrow the scope.' }),
    ).toThrow(/PLAN_REVIEW_SCOPE_CHANGED/);
  });
});
