import { beforeEach, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import { usePlanReviewSubmit } from './usePlanReviewSubmit';
import type { PendingPlanReviewRequest } from './planReviewRequestModel';

const mock = vi.hoisted(() => ({
  sessionId: 's', messages: [] as ConversationMessage[], answer: vi.fn(), queue: vi.fn(),
  sessionListeners: new Set<() => void>(), conversationListeners: new Set<() => void>(),
}));
vi.mock('react', () => ({ useCallback: (fn: unknown) => fn }));
vi.mock('../../hooks/useElectronApi', () => ({ useElectronApi: () => ({ conversation: { answerPlanReview: mock.answer } }) }));
vi.mock('../../stores/projectStore', () => ({ useProjectStore: {
  getState: () => ({ currentSession: { sessionId: mock.sessionId } }),
  subscribe: (fn: () => void) => { mock.sessionListeners.add(fn); return () => mock.sessionListeners.delete(fn); },
} }));
vi.mock('../../stores/conversationStore', () => ({ useConversationStore: {
  getState: () => ({ conversationMessages: mock.messages }),
  subscribe: (fn: () => void) => { mock.conversationListeners.add(fn); return () => mock.conversationListeners.delete(fn); },
} }));
vi.mock('../../stores/composerSessionContextStore', () => ({ useComposerSessionContextStore: {
  getState: () => ({ queueHandoffSuggestion: mock.queue }),
} }));

const request: PendingPlanReviewRequest = {
  sessionId: 's', turnId: 't', toolCallId: 'c',
  planReview: { planId: 'p', revision: 1, hash: 'h', uri: 'session://plans/plan.md',
    title: 'Plan', summary: [], sections: [], status: 'awaiting', handoffOptions: [{ agent: 'general', label: 'Execute' }] },
};
const approve = { kind: 'approve' as const, handoff: request.planReview.handoffOptions[0] };
function trace(status: 'awaiting' | 'approved' | 'superseded' = 'awaiting', revision = 1, delegated = false): ConversationMessage {
  return { id: 'm', sessionId: 's', projectId: 'p', turnId: delegated ? 'parent' : 't', role: 'assistant',
    status: 'streaming', content: '', createdAt: 1, workTrace: { summary: '', status: 'running', updatedAt: 1,
      blocks: [{ id: 'b', kind: 'plan_review', title: 'Plan', status: 'running', startedAt: 1,
        toolCalls: [{ id: delegated ? 'parent-call' : 'c', toolName: 'plan_artifact', status: 'running', startedAt: 1,
          ...(delegated ? { delegatedRequest: { executionId: 'e', childSessionId: 'child', turnId: 't', toolCallId: 'c' } } : {}),
          planReview: { ...request.planReview, status, revision } }] }] } };
}
function notify() { mock.conversationListeners.forEach((fn) => fn()); mock.sessionListeners.forEach((fn) => fn()); }
beforeEach(() => {
  vi.clearAllMocks(); mock.sessionId = 's'; mock.messages = [trace()];
  mock.sessionListeners.clear(); mock.conversationListeners.clear();
  mock.answer.mockResolvedValue({ success: true });
});

it.each([false, true])('queues the declared target even when approval projects before IPC resolves (delegated=%s)', async (delegated) => {
  mock.messages = [trace('awaiting', 1, delegated)];
  mock.answer.mockImplementation(async () => { mock.messages = [trace('approved', 1, delegated)]; notify(); return { success: true }; });
  await usePlanReviewSubmit()(request, approve);
  expect(mock.answer).toHaveBeenCalledWith({ sessionId: 's', turnId: 't', toolCallId: 'c', decision: approve });
  expect(mock.queue).toHaveBeenCalledExactlyOnceWith({ sessionId: 's', agentId: 'general', label: 'Execute', prompt: '', send: true });
  expect(mock.sessionListeners.size + mock.conversationListeners.size).toBe(0);
});

it.each(['session', 'stop', 'revision', 'superseded', 'removed'])('drops late success after %s, including switching back', async (reason) => {
  let finish!: (value: { success: boolean }) => void;
  mock.answer.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const running = usePlanReviewSubmit()(request, approve);
  if (reason === 'session') mock.sessionId = 'other';
  if (reason === 'stop') mock.messages[0].status = 'stopped';
  if (reason === 'revision') mock.messages = [trace('awaiting', 2)];
  if (reason === 'superseded') mock.messages = [trace('superseded')];
  if (reason === 'removed') mock.messages = [];
  notify();
  mock.sessionId = 's'; mock.messages = [trace('approved')]; notify();
  finish({ success: true }); await running;
  expect(mock.queue).not.toHaveBeenCalled();
  expect(mock.sessionListeners.size + mock.conversationListeners.size).toBe(0);
});

it('rejects with feedback without queuing a continuation', async () => {
  await usePlanReviewSubmit()(request, { kind: 'reject', feedback: 'Change scope' });
  expect(mock.answer).toHaveBeenCalled(); expect(mock.queue).not.toHaveBeenCalled();
});
it('surfaces a failed approval and allows retry while releasing subscriptions', async () => {
  mock.answer.mockResolvedValueOnce({ success: false, error: 'unavailable' });
  const submit = usePlanReviewSubmit();
  await expect(submit(request, approve)).rejects.toThrow('unavailable');
  expect(mock.queue).not.toHaveBeenCalled();
  expect(mock.sessionListeners.size + mock.conversationListeners.size).toBe(0);
  await submit(request, approve); expect(mock.queue).toHaveBeenCalledTimes(1);
});
