// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useQueuedHandoffSuggestion } from './useQueuedHandoffSuggestion';
import { useComposerSessionContextStore as context } from '../../stores/composerSessionContextStore';
import { useProjectStore } from '../../stores/projectStore';
import { useConversationStore } from '../../stores/conversationStore';
const mock = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock('./sessionAgentId', () => ({ applyDeclaredHandoffOnClient: mock.apply }));
let root: Root;
let controller: ReturnType<typeof useQueuedHandoffSuggestion>;
const setPrompt = vi.fn(); const send = vi.fn(); const inspect = vi.fn();
const request = () => ({ sessionId: 's', agentId: 'general', label: 'Execute with General', prompt: 'execute', send: true });
function Probe({ busy = false }) {
  controller = useQueuedHandoffSuggestion({ sessionId: useProjectStore(s => s.currentSession?.sessionId),
    isComposerBusy: busy, setPromptValue: setPrompt, sendPrompt: send, inspectRequest: inspect });
  return null;
}
const render = (busy = false) => act(async () => root.render(createElement(Probe, { busy })));
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.clearAllMocks();
  useProjectStore.setState({ currentSession: { sessionId: 's' } as never });
  context.setState({ handoffSuggestionRequest: request(), activeTurn: null, isPromptSending: false });
  useConversationStore.setState({ conversationMessages: [] });
  mock.apply.mockResolvedValue({ ok: true, suggestion: { prompt: 'confirmed prompt' } });
  send.mockResolvedValue({ status: 'accepted', requestId: 'request-1' });
  inspect.mockResolvedValue({ status: 'unknown', requestId: 'request-1' });
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); document.body.replaceChildren(); vi.unstubAllGlobals(); });
it('sends the confirmed payload once, preserving the draft across re-renders', async () => {
  await render(); await render();
  expect(send).toHaveBeenCalledExactlyOnceWith({ prompt: 'confirmed prompt', sessionId: 's', agentId: 'general' });
  expect(setPrompt).not.toHaveBeenCalled(); expect(context.getState().handoffSuggestionRequest).toBeNull();
});
it('waits for both the original active request and restored busy state to release', async () => {
  context.setState({ activeTurn: { sessionId: 's' } as never }); await render(true);
  expect(send).not.toHaveBeenCalled();
  await act(async () => context.setState({ activeTurn: null })); expect(send).not.toHaveBeenCalled();
  await render(false); expect(send).toHaveBeenCalledTimes(1);
});
it('prefills ordinary send:false suggestions only', async () => {
  context.setState({ handoffSuggestionRequest: { ...request(), send: false } }); await render();
  expect(setPrompt).toHaveBeenCalledExactlyOnceWith('confirmed prompt'); expect(send).not.toHaveBeenCalled();
});
it.each(['session', 'stop'])('isolates late switch results after %s', async reason => {
  let finish!: (result: unknown) => void;
  mock.apply.mockImplementation(() => new Promise(resolve => { finish = resolve; })); await render();
  await act(async () => {
    if (reason === 'stop') context.getState().clearHandoffSuggestion();
    else useProjectStore.setState({ currentSession: { sessionId: 'other' } as never });
    finish({ ok: true, suggestion: { prompt: 'late' } });
  });
  expect(setPrompt).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});
it('retains a switch failure for explicit retry without changing the draft', async () => {
  mock.apply.mockResolvedValueOnce({ ok: false, error: 'AGENT_UNAVAILABLE' }); await render();
  expect(controller.error).toBe('AGENT_UNAVAILABLE'); expect(send).not.toHaveBeenCalled();
  await act(async () => controller.retry());
  expect(mock.apply).toHaveBeenCalledTimes(2); expect(send).toHaveBeenCalledTimes(1); expect(setPrompt).not.toHaveBeenCalled();
});
it('retries a definite send rejection without applying the handoff again', async () => {
  send.mockResolvedValueOnce({ status: 'rejected', requestId: 'r', error: 'SEND_DENIED' }); await render();
  expect(controller.error).toBe('SEND_DENIED'); await act(async () => controller.retry());
  expect(mock.apply).toHaveBeenCalledTimes(1); expect(send).toHaveBeenCalledTimes(2); expect(setPrompt).not.toHaveBeenCalled();
});
it('reconciles uncertain delivery without sending again, including repeated checks', async () => {
  send.mockResolvedValue({ status: 'unknown', requestId: 'r', error: 'HANDOFF_DELIVERY_UNCONFIRMED' }); await render();
  expect(controller.checking).toBe(true);
  await act(async () => { await controller.retry(); await controller.retry(); });
  expect(send).toHaveBeenCalledTimes(1); expect(mock.apply).toHaveBeenCalledTimes(1);
  inspect.mockResolvedValue({ status: 'accepted', requestId: 'r' }); await act(async () => controller.retry());
  expect(context.getState().handoffSuggestionRequest).toBeNull(); expect(send).toHaveBeenCalledTimes(1);
});
it('does not send a superseded source plan', async () => {
  context.setState({ handoffSuggestionRequest: { ...request(), sourcePlan: { turnId: 'old', toolCallId: 'old', planId: 'old', revision: 1, hash: 'old' } } });
  await render(); expect(mock.apply).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled(); expect(setPrompt).not.toHaveBeenCalled();
});

it('does not revive an earlier approved handoff when a later review has already ended', async () => {
  const sourcePlan = { turnId: 't', toolCallId: 'c', planId: 'p', revision: 1, hash: 'h' };
  context.setState({ handoffSuggestionRequest: { ...request(), sourcePlan } });
  useConversationStore.setState({ conversationMessages: [{ role: 'assistant', sessionId: 's', turnId: 't', status: 'complete',
    workTrace: { blocks: [{ toolCalls: [{ id: 'c', planReview: { planId: 'p', revision: 1, hash: 'h', status: 'approved' } },
      { id: 'later', planReview: { planId: 'p', revision: 2, hash: 'h2', status: 'cancelled' } }] }] } }] as never });
  await render(); expect(send).not.toHaveBeenCalled();
});
