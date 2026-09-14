import { beforeEach, expect, it, vi } from 'vitest';
import { useQueuedHandoffSuggestion } from './useQueuedHandoffSuggestion';
const mock = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)>, ready: null as unknown,
  currentSession: 's', request: null as any, persist: vi.fn(), clear: vi.fn(), send: vi.fn(), setPrompt: vi.fn(), notice: vi.fn() }));
vi.mock('react', () => ({ useRef: (current: unknown) => ({ current }), useState: () => [mock.ready, (value: unknown) => { mock.ready = value; }], useEffect: (effect: () => void) => { mock.effects.push(effect); } }));
vi.mock('./sessionAgentId', () => ({ persistSessionAgentId: mock.persist }));
vi.mock('../../stores/projectStore', () => ({ useProjectStore: { getState: () => ({ currentSession: { sessionId: mock.currentSession } }) } }));
vi.mock('../../stores/composerSessionContextStore', () => {
  const state = () => ({ handoffSuggestionRequest: mock.request, clearHandoffSuggestion: mock.clear, activeTurn: null, isPromptSending: false });
  return { useComposerSessionContextStore: Object.assign((select: (s: unknown) => unknown) => select(state()), { getState: state }) };
});
const RenderProbe = (promptValue = 'original draft') => {
  mock.effects = [];
  useQueuedHandoffSuggestion({ sessionId: mock.currentSession, promptValue, setPromptValue: mock.setPrompt, sendPrompt: mock.send, showNotice: mock.notice });
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => {
  vi.clearAllMocks(); mock.ready = null; mock.currentSession = 's';
  mock.request = { sessionId: 's', agentId: 'general', prompt: 'execute', send: true };
  mock.clear.mockImplementation(() => { mock.request = null; });
  mock.persist.mockResolvedValue({ ok: true });
});
it('preserves draft and reports failed agent switches', async () => {
  mock.persist.mockResolvedValue({ ok: false, error: 'AGENT_UNAVAILABLE' });
  RenderProbe(); mock.effects[0](); await flush();
  expect(mock.setPrompt).not.toHaveBeenCalled(); expect(mock.send).not.toHaveBeenCalled();
  expect(mock.notice).toHaveBeenCalledWith('AGENT_UNAVAILABLE');
});
it.each(['session', 'stop'])('drops a late switch completion after %s', async reason => {
  let finish!: (value: unknown) => void;
  mock.persist.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  RenderProbe(); mock.effects[0]();
  if (reason === 'session') mock.currentSession = 'other'; else mock.clear();
  finish({ ok: true }); await flush();
  expect(mock.setPrompt).not.toHaveBeenCalled(); expect(mock.send).not.toHaveBeenCalled();
});
it('sends once only after the selected prompt is rendered', async () => {
  RenderProbe(); mock.effects[0](); await flush();
  expect(mock.setPrompt).toHaveBeenCalledWith('execute'); expect(mock.send).not.toHaveBeenCalled();
  RenderProbe('execute'); mock.effects[1](); mock.effects[1]();
  expect(mock.send).toHaveBeenCalledTimes(1);
});
it('prefills without sending for send false', async () => {
  mock.request.send = false;
  RenderProbe(); mock.effects[0](); await flush();
  expect(mock.setPrompt).toHaveBeenCalledWith('execute'); expect(mock.ready).toBeNull(); expect(mock.send).not.toHaveBeenCalled();
});
