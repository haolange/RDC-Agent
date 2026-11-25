import { beforeEach, expect, it, vi } from 'vitest';
import { usePlanReviewStore } from '../../stores/planReviewStore';
import { useTurnControlsStore } from '../../stores/turnControlsStore';
import { usePlanReviewSubmit } from './usePlanReviewSubmit';
import type { ConversationMessage } from '@shared/types/conversation';
import type { PendingPlanReviewRequest } from './planReviewRequestModel';
import type { SessionModelOverride } from '@shared/types/session';

const mock = vi.hoisted(() => ({
  sessionId: 's', modelOverride: null as SessionModelOverride | null, messages: [] as ConversationMessage[],
  answer: vi.fn(), history: vi.fn(), queue: vi.fn(), flush: vi.fn(), accept: vi.fn(),
  sessionListeners: new Set<() => void>(), conversationListeners: new Set<() => void>(),
  sourceRoute: { providerId: 'p', modelId: 'model' } as { providerId: string; modelId: string } | undefined,
}));
vi.mock('./sessionModelOverride', () => ({ flushSessionModelSaves: mock.flush }));
vi.mock('../../stores/appSettingsStore', () => ({ useAppSettingsStore: { getState: () => ({ settings: {
  agents: { definitions: [{ id: 'general', compiledRoute: { providerId: 'p', modelId: 'target-default' } }, { id: 'debugger', compiledRoute: mock.sourceRoute }] },
} }) } }));
vi.mock('react', () => ({ useCallback: (fn: unknown) => fn }));
vi.mock('../../hooks/useElectronApi', () => ({ useElectronApi: () => ({ conversation: { answerPlanReview: mock.answer, getHistory: mock.history } }) }));
vi.mock('../../stores/sessionRecordStore', () => ({
  getSessionView: () => ({ sessionId: mock.sessionId, agentId: 'debugger', modelOverride: mock.modelOverride }),
  useSessionRecordStore: { getState: () => ({ records: { s: { revision: { epoch: 'run-1', n: 7 } } } }) },
  acceptSessionSnapshot: mock.accept,
}));
vi.mock('../../stores/projectStore', () => ({ useProjectStore: {
  getState: () => ({ currentSessionId: mock.sessionId }),
  subscribe: (fn: () => void) => { mock.sessionListeners.add(fn); return () => mock.sessionListeners.delete(fn); },
} }));
vi.mock('../../stores/conversationStore', () => ({ useConversationStore: {
  getState: () => ({ conversationMessages: mock.messages }),
  subscribe: (fn: () => void) => { mock.conversationListeners.add(fn); return () => mock.conversationListeners.delete(fn); },
} }));
vi.mock('../../stores/composerSessionContextStore', () => ({ useComposerSessionContextStore: {
  getState: () => ({ queueHandoffSuggestion: mock.queue }),
} }));

const request: PendingPlanReviewRequest = { reviewId: 'review', agentId: 'debugger', recovered: false,
  sessionId: 's', turnId: 't', toolCallId: 'c',
  planReview: { planId: 'p', revision: 1, hash: 'h', uri: 'session://plans/plan.md',
    title: 'Plan', summary: [], sections: [], status: 'awaiting', handoffOptions: [{ agent: 'general', label: 'Execute' }] },
};
const approve = { kind: 'approve' as const, handoff: request.planReview.handoffOptions[0] };
const controls = { reasoningLevel: 'high' as const, fastModel: true, maxContextMode: true };
const committed = { record: { sessionId: 's', agentId: 'general' }, revision: { epoch: 'run-1', n: 8 } };
function approved(send = true) {
  return { decision: 'approve', session: committed, handoff: { prompt: 'Execute the frozen plan.', send },
    planReview: { sessionId: 's', projectionVersion: ++projectionVersion, review: null, recoverable: null, decision: { reviewId: 'review', kind: 'approve' } } };
}
function trace(status: 'awaiting' | 'approved' | 'superseded' = 'awaiting', revision = 1): ConversationMessage {
  return { id: 'm', sessionId: 's', projectId: 'p', turnId: 't', role: 'assistant',
    status: 'streaming', content: '', createdAt: 1, workTrace: { summary: '', status: 'running', updatedAt: 1,
      blocks: [{ id: 'b', kind: 'plan_review', title: 'Plan', status: 'running', startedAt: 1,
        toolCalls: [{ id: 'c', toolName: 'plan_artifact', status: 'running', startedAt: 1,
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
  mock.sourceRoute = { providerId: 'p', modelId: 'model' };
  useTurnControlsStore.setState({ turnControls: controls });
  mock.flush.mockReturnValue(undefined);
  mock.sessionListeners.clear(); mock.conversationListeners.clear();
  mock.answer.mockImplementation(async () => approved());
  mock.history.mockResolvedValue({ planReview: null });
});

it('approves in one call carrying the reviewed hash, the inherited route, every control and the base revision', async () => {
  await usePlanReviewSubmit()(request, approve);
  expect(mock.answer).toHaveBeenCalledExactlyOnceWith({ sessionId: 's', reviewId: 'review', decision: approve,
    expectedPlanHash: 'h', model: { providerId: 'p', modelId: 'model' }, controls, baseRevision: { epoch: 'run-1', n: 7 } });
  expect(mock.accept).toHaveBeenCalledExactlyOnceWith(committed);
  expect(usePlanReviewStore.getState().bySession.s.decision).toEqual({ reviewId: 'review', kind: 'approve' });
  expect(mock.queue).toHaveBeenCalledExactlyOnceWith({ sessionId: 's', agentId: 'general', label: 'Execute',
    prompt: 'Execute the frozen plan.', send: true, approval: { reviewId: 'review', planId: 'p', revision: 1, hash: 'h' } });
  expect(mock.sessionListeners.size + mock.conversationListeners.size).toBe(0);
});

it('approves with the saved Composer override instead of either Agent default', async () => {
  mock.modelOverride = { providerId: 'grok-account', modelId: 'grok-4.7' };
  await usePlanReviewSubmit()(request, approve);
  expect(mock.answer.mock.calls[0]![0].model).toEqual({ providerId: 'grok-account', modelId: 'grok-4.7' });
});

it('needs a model before approving', async () => {
  mock.sourceRoute = undefined;
  await expect(usePlanReviewSubmit()(request, approve)).rejects.toThrow('MODEL_UNAVAILABLE');
  expect(mock.answer).not.toHaveBeenCalled();
});

it('waits for queued edits and approves with the latest model and controls', async () => {
  let finish!: () => void;
  mock.flush.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const running = usePlanReviewSubmit()(request, approve);
  expect(mock.answer).not.toHaveBeenCalled();
  mock.modelOverride = { providerId: 'grok-account', modelId: 'grok-4.7' };
  const latest = { reasoningLevel: 'low' as const, fastModel: false, maxContextMode: true };
  useTurnControlsStore.setState({ turnControls: latest });
  finish(); await running;
  expect(mock.answer).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ model: mock.modelOverride, controls: latest }));
});

it('does not approve after a queued edit failed to save', async () => {
  mock.flush.mockReturnValueOnce(Promise.reject(new Error('MODEL_SAVE_FAILED')));
  await expect(usePlanReviewSubmit()(request, approve)).rejects.toThrow('MODEL_SAVE_FAILED');
  expect(mock.answer).not.toHaveBeenCalled(); expect(mock.queue).not.toHaveBeenCalled();
});

it.each(['session', 'stop', 'revision'])('does not approve when %s changes while queued edits save', async (change) => {
  let finish!: () => void;
  mock.flush.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const running = usePlanReviewSubmit()(request, approve);
  if (change === 'session') mock.sessionId = 'other';
  if (change === 'stop') mock.messages[0].status = 'stopped';
  if (change === 'revision') mock.messages = [trace('awaiting', 2)];
  notify(); finish(); await running;
  expect(mock.answer).not.toHaveBeenCalled(); expect(mock.queue).not.toHaveBeenCalled();
});

it.each(['session', 'stop', 'revision', 'superseded', 'removed'])('drops late success after %s, including switching back', async (reason) => {
  let finish!: (value: unknown) => void;
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
  finish(approved()); await running;
  expect(mock.queue).not.toHaveBeenCalled();
  expect(mock.sessionListeners.size + mock.conversationListeners.size).toBe(0);
});

it('prefills instead of sending when the declaration does not send', async () => {
  mock.answer.mockImplementation(async () => approved(false));
  await usePlanReviewSubmit()(request, approve);
  expect(mock.queue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ send: false, prompt: 'Execute the frozen plan.' }));
});

it('rejects with feedback without queuing a continuation', async () => {
  mock.answer.mockResolvedValueOnce({ decision: 'reject', planReview: { sessionId: 's', projectionVersion: ++projectionVersion,
    review: null, recoverable: null, decision: { reviewId: 'review', kind: 'reject' } } });
  await usePlanReviewSubmit()(request, { kind: 'reject', feedback: 'Change scope' });
  expect(mock.answer).toHaveBeenCalledExactlyOnceWith({ sessionId: 's', reviewId: 'review', decision: { kind: 'reject', feedback: 'Change scope' } });
  expect(mock.queue).not.toHaveBeenCalled(); expect(mock.accept).not.toHaveBeenCalled();
});

it('reads authority after a lost approval response without replaying or executing it', async () => {
  mock.answer.mockRejectedValueOnce(new Error('response lost'));
  mock.history.mockResolvedValueOnce({ planReview: { sessionId: 's', projectionVersion: 1000,
    review: null, recoverable: null, decision: { reviewId: 'review', kind: 'approve' } } });
  await expect(usePlanReviewSubmit()(request, approve)).rejects.toThrow('response lost');
  expect(mock.answer).toHaveBeenCalledOnce(); expect(mock.history).toHaveBeenCalledWith('s');
  expect(mock.queue).not.toHaveBeenCalled();
  expect(usePlanReviewStore.getState().bySession.s.decision?.kind).toBe('approve');
});

it('surfaces a refused approval and allows retry while releasing subscriptions', async () => {
  mock.answer.mockRejectedValueOnce(Object.assign(new Error('HOOK_DENIED: agent.before-handoff'), { code: 'HOOK_DENIED' }));
  const submit = usePlanReviewSubmit();
  await expect(submit(request, approve)).rejects.toThrow('HOOK_DENIED');
  expect(mock.queue).not.toHaveBeenCalled();
  expect(mock.sessionListeners.size + mock.conversationListeners.size).toBe(0);
  await submit(request, approve); expect(mock.queue).toHaveBeenCalledOnce();
});
