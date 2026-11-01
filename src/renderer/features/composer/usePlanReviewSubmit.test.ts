import { beforeEach, expect, it, vi } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import { usePlanReviewSubmit } from './usePlanReviewSubmit';
import type { PendingPlanReviewRequest } from './planReviewRequestModel';
import { usePlanReviewStore } from '../../stores/planReviewStore';
import type { SessionModelOverride } from '@shared/types/session';

const mock = vi.hoisted(() => ({
  sessionId: 's', modelOverride: null as SessionModelOverride | null, messages: [] as ConversationMessage[], answer: vi.fn(), queue: vi.fn(), clear: vi.fn(), load: vi.fn(),
  sessionListeners: new Set<() => void>(), conversationListeners: new Set<() => void>(),
  history: vi.fn(),
}));
vi.mock('./useComposerModelPickerOptions', () => ({ loadComposerModelPickerOptions: mock.load }));
vi.mock('../../stores/appSettingsStore', () => ({ useAppSettingsStore: { getState: () => ({ settings: {
  llm: { providers: [{ id: 'p', enabled: true, isConfigured: true }, { id: 'grok-account', enabled: true, isConfigured: true }] }, agents: { definitions: [{ id: 'general', compiledRoute: { providerId: 'p', modelId: 'model' } }] },
} }) } }));
vi.mock('react', () => ({ useCallback: (fn: unknown) => fn }));
vi.mock('../../hooks/useElectronApi', () => ({ useElectronApi: () => ({ conversation: { answerPlanReview: mock.answer, getHistory: mock.history } }) }));
vi.mock('../../stores/projectStore', () => ({ useProjectStore: {
  getState: () => ({ currentSession: { sessionId: mock.sessionId, modelOverride: mock.modelOverride } }),
  subscribe: (fn: () => void) => { mock.sessionListeners.add(fn); return () => mock.sessionListeners.delete(fn); },
} }));
vi.mock('../../stores/conversationStore', () => ({ useConversationStore: {
  getState: () => ({ conversationMessages: mock.messages }),
  subscribe: (fn: () => void) => { mock.conversationListeners.add(fn); return () => mock.conversationListeners.delete(fn); },
} }));
vi.mock('../../stores/composerSessionContextStore', () => ({ useComposerSessionContextStore: {
  getState: () => ({ queueHandoffSuggestion: mock.queue, clearHandoffSuggestion: mock.clear }),
} }));

const request: PendingPlanReviewRequest = { reviewId: 'review', agentId: 'debugger', recovered: false,
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
let projectionVersion = 0;
function publishReview() {
  const message = mock.messages[0];
  const plan = message?.workTrace?.blocks.flatMap(block => block.toolCalls).at(-1)?.planReview;
  const active = message && message.status !== 'stopped' && message.status !== 'error' && plan?.status === 'awaiting';
  usePlanReviewStore.getState().accept({ sessionId: 's', projectionVersion: ++projectionVersion, recoverable: null,
    review: active ? { ...request, reviewId: plan.revision === 1 ? 'review' : 'replacement', planReview: plan } : null,
    ...(plan?.status === 'approved' ? { decision: { reviewId: 'review', kind: 'approve' as const } } : {}) });
}
function notify() { publishReview(); mock.conversationListeners.forEach((fn) => fn()); mock.sessionListeners.forEach((fn) => fn()); }
beforeEach(() => {
  vi.clearAllMocks(); mock.sessionId = 's'; mock.messages = [trace()];
  mock.modelOverride = null; usePlanReviewStore.getState().reset(); publishReview();
  mock.load.mockResolvedValue([{ providerId: 'p', modelId: 'model' }, { providerId: 'grok-account', modelId: 'grok-4.7' }]);
  mock.sessionListeners.clear(); mock.conversationListeners.clear();
  mock.answer.mockResolvedValue({ success: true });
});

it('validates the saved Composer override instead of switching to the handoff target default', async () => {
  mock.modelOverride = { providerId: 'grok-account', modelId: 'grok-4.7' };
  await usePlanReviewSubmit()(request, approve);
  expect(mock.load).toHaveBeenCalledWith([{ id: 'grok-account', enabled: true, isConfigured: true }]);
  expect(mock.answer).toHaveBeenCalledOnce();
  expect(mock.modelOverride).toEqual({ providerId: 'grok-account', modelId: 'grok-4.7' });
});

it.each([false, true])('queues the declared target even when approval projects before IPC resolves (delegated=%s)', async (delegated) => {
  mock.messages = [trace('awaiting', 1, delegated)];
  mock.answer.mockImplementation(async () => { mock.messages = [trace('approved', 1, delegated)]; notify(); return { success: true }; });
  await usePlanReviewSubmit()(request, approve);
  expect(mock.answer).toHaveBeenCalledWith({ sessionId: 's', reviewId: 'review', decision: approve });
  expect(mock.queue).toHaveBeenLastCalledWith({ phase: 'handoff', sessionId: 's', agentId: 'general', label: 'Execute', prompt: '', send: true, sourcePlan: { reviewId: 'review', turnId: 't', toolCallId: 'c', planId: 'p', revision: 1, hash: 'h' } });
  expect(mock.sessionListeners.size + mock.conversationListeners.size).toBe(0);
});

it.each(['session', 'stop', 'revision', 'superseded', 'removed'])('drops late success after %s, including switching back', async (reason) => {
  let finish!: (value: { success: boolean }) => void;
  mock.answer.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const running = usePlanReviewSubmit()(request, approve);
  await vi.waitFor(() => expect(mock.answer).toHaveBeenCalledOnce());
  if (reason === 'session') mock.sessionId = 'other';
  if (reason === 'stop') mock.messages[0].status = 'stopped';
  if (reason === 'revision') mock.messages = [trace('awaiting', 2)];
  if (reason === 'superseded') mock.messages = [trace('superseded')];
  if (reason === 'removed') mock.messages = [];
  notify();
  mock.sessionId = 's'; mock.messages = [trace('approved')]; notify();
  finish({ success: true }); await running;
  expect(mock.queue.mock.calls.some(([value]) => value.phase === 'handoff')).toBe(false);
  expect(mock.sessionListeners.size + mock.conversationListeners.size).toBe(0);
});

it('rejects with feedback without queuing a continuation', async () => {
  await usePlanReviewSubmit()(request, { kind: 'reject', feedback: 'Change scope' });
  expect(mock.answer).toHaveBeenCalled(); expect(mock.queue).not.toHaveBeenCalled();
});
it('reads authority after a lost approval response without replaying or executing it', async () => {
  mock.answer.mockRejectedValueOnce(new Error('response lost'));
  mock.history.mockResolvedValueOnce({ planReview: { sessionId: 's', projectionVersion: 1000,
    review: null, recoverable: null, decision: { reviewId: 'review', kind: 'approve' } } });
  await expect(usePlanReviewSubmit()(request, approve)).rejects.toThrow('response lost');
  expect(mock.answer).toHaveBeenCalledOnce(); expect(mock.history).toHaveBeenCalledWith('s');
  expect(mock.queue.mock.calls.some(([value]) => value.phase === 'handoff')).toBe(false);
  expect(usePlanReviewStore.getState().bySession.s.decision?.kind).toBe('approve');
});
it('surfaces a failed approval and allows retry while releasing subscriptions', async () => {
  mock.answer.mockResolvedValueOnce({ success: false, error: 'unavailable' });
  const submit = usePlanReviewSubmit();
  await expect(submit(request, approve)).rejects.toThrow('unavailable');
  expect(mock.queue.mock.calls.some(([value]) => value.phase === 'handoff')).toBe(false);
  expect(mock.sessionListeners.size + mock.conversationListeners.size).toBe(0);
  await submit(request, approve); expect(mock.queue).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'handoff' }));
});
