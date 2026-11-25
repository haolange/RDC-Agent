// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useConversationStore } from '../../stores/conversationStore';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';
import { useNotificationStore } from '../../stores/notificationStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionProjectionStore } from '../../stores/sessionProjectionStore';
import { useComposerStop } from './useComposerStop';
import type { SessionRecord } from '@shared/types/session';
import type { ConversationCancelActiveTurnResult, ConversationMessage } from '@shared/types/conversation';

const session: SessionRecord = {
  schemaVersion: '1',
  sessionId: 'session-a', projectId: 'project-a', title: 'A', goal: '', sessionPath: '/a', createdAt: 1, updatedAt: 1,
};
const ownership = {
  sessionId: session.sessionId, projectId: session.projectId, requestId: 'request-a', agentId: 'general',
  optimisticTurnId: null, realTurnId: 'turn-a',
};
const assistant = (patch: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: 'assistant-a', turnId: 'turn-a', requestId: 'request-a', role: 'assistant', agentId: 'general',
  sessionId: session.sessionId, projectId: session.projectId, content: 'partial', status: 'streaming',
  createdAt: 1, updatedAt: 2, workTrace: { status: 'running', updatedAt: 2, blocks: [] }, ...patch,
});
const completed = () => assistant({
  status: 'complete', content: 'Authoritative final answer', updatedAt: 10,
  workTrace: { status: 'complete', updatedAt: 10, blocks: [] },
});
const cancel = vi.fn<() => Promise<ConversationCancelActiveTurnResult>>();
const getHistory = vi.fn();
let root: Root;
let host: HTMLDivElement;
let stop: () => Promise<void>;
let stopPending: boolean[] = [];
function Harness() {
  const controls = useComposerStop({ currentSession: session, currentRun: null, t: (key) => key });
  stop = controls.handlePrimaryStop;
  stopPending.push(controls.stopPending);
  return null;
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  cancel.mockReset().mockResolvedValue({ success: true, phase: 'running' });
  getHistory.mockReset().mockResolvedValue({ messages: [completed()], branchState: null });
  useNotificationStore.setState({ notifications: [] });
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { conversation: { cancelActiveTurn: cancel, getHistory } } });
  useConversationStore.getState().reset();
  useConversationStore.getState().upsertConversationMessage(assistant());
  useComposerSessionContextStore.getState().resetForSessionSwitch();
  useComposerSessionContextStore.getState().beginTurn(ownership);
  useProjectStore.getState().setCurrentSession(session);
  useSessionProjectionStore.getState().reset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  act(() => root.render(createElement(Harness)));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: undefined });
});

it('reports Stop as pending from the click until main answers, including when the request fails', async () => {
  let answer!: (result: ConversationCancelActiveTurnResult) => void;
  cancel.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
  stopPending = [];
  let settled!: Promise<void>;
  await act(async () => { settled = stop(); });
  // The optimistic stop already ended the reply; the button must not fall back to an empty Send meanwhile.
  expect(useConversationStore.getState().conversationMessages[0].status).toBe('stopped');
  expect(stopPending.at(-1)).toBe(true);
  await act(async () => { answer({ success: true, phase: 'running' }); await settled; });
  expect(stopPending.at(-1)).toBe(false);
  cancel.mockRejectedValue(new Error('bridge lost'));
  await act(async () => stop());
  expect(stopPending.at(-1)).toBe(false);
  expect(useNotificationStore.getState().notifications.some((entry) => entry.tone === 'error')).toBe(true);
});

it('restores the matching persisted completion when Stop reaches main after the turn ended', async () => {
  await act(async () => stop());
  expect(cancel).toHaveBeenCalledWith({ sessionId: 'session-a', requestId: 'request-a', turnId: 'turn-a' });
  expect(getHistory).toHaveBeenCalledWith('session-a');
  expect(useConversationStore.getState().conversationMessages[0]).toEqual(completed());
  expect(useComposerSessionContextStore.getState().activeTurn).toBeNull();
});

it('preserves a terminal event delivered while cancellation is waiting', async () => {
  cancel.mockImplementation(async () => {
    useConversationStore.getState().upsertConversationMessage(completed());
    return { success: true, phase: 'running' };
  });
  await act(async () => stop());
  expect(useConversationStore.getState().conversationMessages[0]).toEqual(completed());
});

it('keeps a real main-owned stopped result and its complete tool receipts', async () => {
  cancel.mockResolvedValue({ success: true, phase: 'running', cancelledRequestId: 'request-a', cancelledTurnId: 'turn-a' });
  const stopped = assistant({ status: 'stopped', content: 'Saved partial answer', updatedAt: 10,
    workTrace: { status: 'stopped', updatedAt: 10, blocks: [] } });
  getHistory.mockResolvedValue({ messages: [stopped], branchState: null });
  await act(async () => stop());
  expect(useConversationStore.getState().conversationMessages[0]).toEqual(stopped);
});

it('routes a delayed terminal read to its owning cache after switching sessions', async () => {
  const other = assistant({ id: 'assistant-b', turnId: 'turn-b', requestId: 'request-b', sessionId: 'session-b' });
  getHistory.mockImplementation(async () => {
    useProjectStore.getState().setCurrentSession({ ...session, sessionId: 'session-b' });
    useConversationStore.getState().setConversationMessages([other]);
    useComposerSessionContextStore.getState().beginTurn({ ...ownership, sessionId: 'session-b', requestId: 'request-b' });
    return { messages: [completed()], branchState: null };
  });
  await act(async () => stop());
  expect(useConversationStore.getState().conversationMessages).toEqual([other]);
  expect(useComposerSessionContextStore.getState().activeTurn?.requestId).toBe('request-b');
  expect(useSessionProjectionStore.getState().bySessionId['session-a'].allMessages).toEqual([completed()]);
});

it('merges only the stopped turn without replacing a newer request in the same session', async () => {
  const newer = assistant({ id: 'assistant-new', turnId: 'turn-new', requestId: 'request-new', createdAt: 20, updatedAt: 20 });
  getHistory.mockImplementation(async () => {
    useConversationStore.getState().upsertConversationMessage(newer);
    useComposerSessionContextStore.getState().beginTurn({ ...ownership, requestId: 'request-new', realTurnId: 'turn-new' });
    return { messages: [completed()], branchState: null };
  });
  await act(async () => stop());
  expect(useConversationStore.getState().conversationMessages).toEqual([completed(), newer]);
  expect(useComposerSessionContextStore.getState().activeTurn?.requestId).toBe('request-new');
});

it.each([
  { requestId: 'other' }, { turnId: 'other' }, { sessionId: 'other' }, { agentId: 'other' },
  { status: 'streaming' as const },
])('does not accept an unmatched or nonterminal result %j', async (patch) => {
  getHistory.mockResolvedValue({ messages: [assistant({ ...completed(), ...patch })], branchState: null });
  await act(async () => stop());
  expect(useConversationStore.getState().conversationMessages[0].status).toBe('stopped');
  expect(useConversationStore.getState().conversationMessages[0].content).toBe('partial');
});

it('keeps clean preparing cancellation without reading committed history', async () => {
  useConversationStore.getState().setConversationMessages([assistant({ turnId: 'optimistic-turn-request-a' })]);
  useComposerSessionContextStore.getState().beginTurn({ ...ownership, optimisticTurnId: 'optimistic-turn-request-a', realTurnId: null });
  cancel.mockResolvedValue({ success: true, phase: 'preparing', cancelledRequestId: 'request-a' });
  await act(async () => stop());
  expect(getHistory).not.toHaveBeenCalled();
  expect(useConversationStore.getState().conversationMessages).toEqual([]);
});

it('reports a failed authoritative read without fabricating completion', async () => {
  getHistory.mockRejectedValue(new Error('History unavailable'));
  await act(async () => stop());
  expect(useNotificationStore.getState().notifications[0]).toMatchObject({
    tone: 'error', title: 'app.stopRunFailed', details: [{ label: 'Detail', value: 'History unavailable' }],
  });
  expect(useConversationStore.getState().conversationMessages[0].status).toBe('stopped');
});

it('does not clear the sending state of a newer request after a late history error', async () => {
  getHistory.mockImplementation(async () => {
    useComposerSessionContextStore.getState().beginTurn({ ...ownership, requestId: 'new-request' });
    useComposerSessionContextStore.getState().setIsPromptSending(true);
    throw new Error('History unavailable');
  });
  await act(async () => stop());
  expect(useComposerSessionContextStore.getState().isPromptSending).toBe(true);
  expect(useComposerSessionContextStore.getState().activeTurn?.requestId).toBe('new-request');
});
