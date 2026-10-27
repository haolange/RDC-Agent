// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { sendComposerConversationTurn } from './composerSendFlow';
import { inspectHandoffCommit } from './composerHandoffSend';
import { useConversationStore } from '../../stores/conversationStore';
import { useProjectStore } from '../../stores/projectStore';
import { restoreLastSentIfCurrentSession, useComposerSessionContextStore as context } from '../../stores/composerSessionContextStore';
const mock = vi.hoisted(() => ({ configure: vi.fn(), apply: vi.fn(), sync: vi.fn(), persist: vi.fn() }));
vi.mock('../../stores/conversationConfigurationCommit', () => ({ buildConversationConfigurationCommit: mock.configure }));
vi.mock('../../hooks/useComposerEffectiveModel', () => ({ readComposerEffectiveModel: () => null }));
vi.mock('./sessionModelOverride', () => ({ persistComposerDraftToSession: mock.persist }));
vi.mock('../../stores/conversationSendApply', () => ({ applyConversationTurnResult: mock.apply }));
vi.mock('../../stores/conversationSendE2E', () => ({ syncE2EConversationState: mock.sync }));
const send = vi.fn(); const history = vi.fn(); const prompt = vi.fn(); const attachments = vi.fn(); const skills = vi.fn();
function options(preserveDraft = true): Parameters<typeof sendComposerConversationTurn>[0] {
  return { electronAPI: { settings: { getEffectiveCatalog: vi.fn() }, conversation: { sendMessage: send, getHistory: history } } as never,
    trimmed: 'confirmed handoff prompt', pendingAttachments: [], pendingSkillIds: [], currentMode: 'general',
    currentProject: { projectId: 'p' } as never, currentSession: { sessionId: 's', projectId: 'p' } as never,
    currentRun: null, selectedAgentId: 'general', selectedDeviceEntry: undefined, preserveDraft,
    setPromptValue: prompt, setPendingAttachments: attachments, setPendingSkillIds: skills,
    setConversationMessages: useConversationStore.getState().setConversationMessages,
    upsertConversationMessages: useConversationStore.getState().upsertConversationMessages,
    setBranchState: vi.fn(), setCurrentSession: vi.fn(), setSessions: vi.fn(), setCurrentRun: vi.fn(), setRuns: vi.fn(),
    setTracePresentation: vi.fn(), showNotice: vi.fn(), failedSummary: 'Failed' };
}
beforeEach(() => {
  vi.clearAllMocks(); mock.configure.mockResolvedValue({ configurationCommit: { agentId: 'general' } });
  mock.apply.mockResolvedValue(undefined); mock.sync.mockResolvedValue(undefined);
  context.setState({ activeTurn: null, lastSent: null });
  useConversationStore.getState().setConversationMessages([]);
  useProjectStore.setState({ currentProject: { projectId: 'p' } as never, currentSession: { sessionId: 's' } as never });
  send.mockResolvedValue({ status: 'accepted', preparedContext: null, turn: { userMessage: { turnId: 't', sessionId: 's' }, assistantDraftMessage: { sessionId: 's' } } });
  history.mockResolvedValue({ messages: [] });
});
it.each(['accepted', 'rejected', 'cancelled'])('preserves the existing draft, attachments and skills on %s', async status => {
  if (status !== 'accepted') send.mockResolvedValue({ status: 'rejected', error: { code: status === 'cancelled' ? 'REQUEST_CANCELLED' : 'DENIED', message: 'Denied' } });
  const result = await sendComposerConversationTurn(options());
  expect(result.status).toBe(status);
  expect(prompt).not.toHaveBeenCalled(); expect(attachments).not.toHaveBeenCalled(); expect(skills).not.toHaveBeenCalled();
  expect(mock.persist).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'general', message: 'confirmed handoff prompt', attachments: [], preloadSkillIds: [] }));
});
it('restores ordinary failed submissions through the original draft path', async () => {
  send.mockResolvedValue({ status: 'rejected', error: { code: 'DENIED', message: 'Denied' } });
  await sendComposerConversationTurn(options(false)); expect(prompt.mock.calls).toEqual([[''], ['confirmed handoff prompt']]);
});
it('does not turn post-acceptance projection failure into a retryable rejection', async () => {
  mock.apply.mockRejectedValueOnce(new Error('projection unavailable'));
  expect((await sendComposerConversationTurn(options())).status).toBe('accepted'); expect(send).toHaveBeenCalledTimes(1);
});
it('checks history after an ambiguous transport error and never resends', async () => {
  send.mockRejectedValue(new Error('connection reset'));
  let result = await sendComposerConversationTurn(options()); expect(result.status).toBe('unknown');
  history.mockResolvedValue({ messages: [{ role: 'user', requestId: result.requestId }] });
  result = await inspectHandoffCommit(options().electronAPI.conversation, 's', result.requestId);
  expect(result.status).toBe('accepted'); expect(send).toHaveBeenCalledTimes(1);
});
it('only exposes retry for a confirmed pre-dispatch failure', async () => {
  mock.configure.mockRejectedValueOnce(new Error('save failed'));
  expect((await sendComposerConversationTurn(options())).status).toBe('rejected'); expect(send).not.toHaveBeenCalled();
});
it('does not restore the handoff payload into the composer when Stop revokes preparation', () => {
  context.getState().setLastSent({ sessionId: 's', projectId: 'p', prompt: 'handoff', attachments: [], skillIds: [], preserveDraft: true });
  expect(restoreLastSentIfCurrentSession('s', prompt)).toBe(true); expect(prompt).not.toHaveBeenCalled();
});
