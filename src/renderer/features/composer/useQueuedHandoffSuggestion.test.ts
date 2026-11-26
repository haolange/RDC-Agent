// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useComposerSessionContextStore as context } from '../../stores/composerSessionContextStore';
import { useProjectStore } from '../../stores/projectStore';
import { useConversationStore } from '../../stores/conversationStore';
import { usePlanReviewStore } from '../../stores/planReviewStore';
import { useQueuedHandoffSuggestion } from './useQueuedHandoffSuggestion';
const mock = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock('./sessionAgentId', () => ({ applyDeclaredHandoffOnClient: mock.apply }));
let root: Root;
let controller: ReturnType<typeof useQueuedHandoffSuggestion>;
const setPrompt = vi.fn();
const send = vi.fn();
const inspect = vi.fn();
const request = () => ({
  sessionId: 's',
  agentId: 'general',
  label: 'Execute with General',
  prompt: 'execute',
  send: true,
});
function Probe({ busy = false }) {
  controller = useQueuedHandoffSuggestion({
    sessionId: useProjectStore((s) => s.currentSessionId),
    isComposerBusy: busy,
    setPromptValue: setPrompt,
    sendPrompt: send,
    inspectRequest: inspect,
  });
  return null;
}
const render = (busy = false) => act(async () => root.render(createElement(Probe, { busy })));
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.clearAllMocks();
  usePlanReviewStore.getState().reset();
  useProjectStore.setState({ currentSessionId: 's' });
  context.setState({ handoffSuggestionRequest: request(), activeTurn: null, isPromptSending: false });
  useConversationStore.setState({ conversationMessages: [] });
  mock.apply.mockResolvedValue({ ok: true, suggestion: { prompt: 'confirmed prompt' } });
  send.mockResolvedValue({ status: 'accepted', requestId: 'request-1' });
  inspect.mockResolvedValue({ status: 'unknown', requestId: 'request-1' });
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});
it('sends the confirmed payload once, preserving the draft across re-renders', async () => {
  await render();
  await render();
  expect(send).toHaveBeenCalledExactlyOnceWith({ prompt: 'confirmed prompt', sessionId: 's', agentId: 'general' });
  expect(setPrompt).not.toHaveBeenCalled();
  expect(context.getState().handoffSuggestionRequest).toBeNull();
});
it('waits for both the original active request and restored busy state to release', async () => {
  context.setState({ activeTurn: { sessionId: 's' } as never });
  await render(true);
  expect(send).not.toHaveBeenCalled();
  await act(async () => context.setState({ activeTurn: null }));
  expect(send).not.toHaveBeenCalled();
  await render(false);
  expect(send).toHaveBeenCalledTimes(1);
});
it('prefills ordinary send:false suggestions only', async () => {
  context.setState({ handoffSuggestionRequest: { ...request(), send: false } });
  await render();
  expect(setPrompt).toHaveBeenCalledExactlyOnceWith('confirmed prompt');
  expect(send).not.toHaveBeenCalled();
});
it.each(['session', 'stop'])('isolates late switch results after %s', async (reason) => {
  let finish!: (result: unknown) => void;
  mock.apply.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await act(async () => {
    if (reason === 'stop') context.getState().clearHandoffSuggestion();
    else useProjectStore.setState({ currentSessionId: 'other' });
    finish({ ok: true, suggestion: { prompt: 'late' } });
  });
  expect(setPrompt).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
it('retains a switch failure for explicit retry without changing the draft', async () => {
  mock.apply.mockResolvedValueOnce({ ok: false, error: 'AGENT_UNAVAILABLE' });
  await render();
  expect(controller.error).toBe('AGENT_UNAVAILABLE');
  expect(send).not.toHaveBeenCalled();
  await act(async () => controller.retry());
  expect(mock.apply).toHaveBeenCalledTimes(2);
  expect(send).toHaveBeenCalledTimes(1);
  expect(setPrompt).not.toHaveBeenCalled();
});
it('retries a definite send rejection without applying the handoff again', async () => {
  send.mockResolvedValueOnce({ status: 'rejected', requestId: 'r', error: 'SEND_DENIED' });
  await render();
  expect(controller.error).toBe('SEND_DENIED');
  await act(async () => controller.retry());
  expect(mock.apply).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(2);
  expect(setPrompt).not.toHaveBeenCalled();
});
it('reconciles uncertain delivery without sending again, including repeated checks', async () => {
  send.mockResolvedValue({ status: 'unknown', requestId: 'r', error: 'HANDOFF_DELIVERY_UNCONFIRMED' });
  await render();
  expect(controller.checking).toBe(true);
  await act(async () => {
    await controller.retry();
    await controller.retry();
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(mock.apply).toHaveBeenCalledTimes(1);
  inspect.mockResolvedValue({ status: 'accepted', requestId: 'r' });
  await act(async () => controller.retry());
  expect(context.getState().handoffSuggestionRequest).toBeNull();
  expect(send).toHaveBeenCalledTimes(1);
});
it('binds a recovered handoff to the currently projected approved hash', async () => {
  const approvedHandoff = {
    agent: 'general',
    label: 'Execute with General',
    prompt: 'execute',
    send: true,
    planHash: 'a'.repeat(64),
    planId: 'plan-a',
    revision: 2,
    planUri: 'session://plans/plan-a/2.md',
    planTitle: 'Plan A',
  };
  usePlanReviewStore
    .getState()
    .accept({ sessionId: 's', projectionVersion: 1, review: null, recoverable: null, approvedHandoff });
  context.setState({
    handoffSuggestionRequest: {
      ...request(),
      approvedPlan: { planId: 'plan-a', revision: 2, hash: approvedHandoff.planHash },
    },
  });
  await render();
  expect(mock.apply).toHaveBeenCalledWith(
    's',
    'general',
    'Execute with General',
    expect.any(Function),
    approvedHandoff.planHash,
  );
  expect(send).toHaveBeenCalledOnce();
  expect(send.mock.calls[0]![0]).toMatchObject({
    planReference: {
      intent: 'execute',
      sessionId: 's',
      planId: 'plan-a',
      revision: 2,
      expectedHash: approvedHandoff.planHash,
    },
  });
});
it('does not dispatch a recovered handoff when its projected approval changed', async () => {
  context.setState({
    handoffSuggestionRequest: { ...request(), approvedPlan: { planId: 'plan-a', revision: 2, hash: 'a'.repeat(64) } },
  });
  usePlanReviewStore.getState().accept({ sessionId: 's', projectionVersion: 1, review: null, recoverable: null });
  await render();
  expect(mock.apply).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
