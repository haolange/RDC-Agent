import { beforeEach, expect, it } from 'vitest';
import { buildOptimisticConversationTurn, removeRequestMessages } from './conversationSendOptimistic';
import { useConversationStore } from './conversationStore';
import type { ConversationMessage } from '@shared/types/conversation';

const optimistic = () => buildOptimisticConversationTurn({
  requestId: 'request-1', trimmed: 'Find the draw', currentProject: null, currentSession: null,
  currentRun: null, pendingAttachments: [],
});
/** What main sends for the same request: the same ids (conversationTurnIds), stamped after the renderer built its own. */
const fromMain = (role: 'user' | 'assistant', overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: role === 'user' ? 'msgu-request-1' : 'msga-request-1', requestId: 'request-1', turnId: 'turn-request-1',
  sessionId: 'session-1', projectId: null,
  role, content: role === 'user' ? 'Find the draw' : 'Working', status: role === 'user' ? 'complete' : 'streaming',
  createdAt: Date.now() + (role === 'user' ? 1_000 : 1_001), updatedAt: Date.now() + 1_001, ...overrides,
});
const visible = () => useConversationStore.getState().conversationMessages.map((message) => [message.id, message.sessionId]);

beforeEach(() => useConversationStore.getState().reset());

it('shows a send under main\'s ids, so main\'s messages update it in place whichever arrives first', () => {
  const { userMessage, assistantDraftMessage } = optimistic();
  expect([userMessage.id, assistantDraftMessage.id]).toEqual(['msgu-request-1', 'msga-request-1']);
  const store = useConversationStore.getState();
  store.upsertConversationMessages([userMessage, assistantDraftMessage]);
  expect(visible()).toEqual([['msgu-request-1', null], ['msga-request-1', null]]);
  // A stream event for the assistant can land before the send result: still one reply, now main's.
  store.upsertConversationMessages([fromMain('assistant')]);
  expect(visible()).toEqual([['msgu-request-1', null], ['msga-request-1', 'session-1']]);
  store.upsertConversationMessages([fromMain('user'), fromMain('assistant')]);
  expect(visible()).toEqual([['msgu-request-1', 'session-1'], ['msga-request-1', 'session-1']]);
});

it('takes a refused send\'s messages back out', () => {
  const failed = optimistic();
  const store = useConversationStore.getState();
  store.upsertConversationMessages([failed.userMessage, failed.assistantDraftMessage]);
  store.setConversationMessages(removeRequestMessages(useConversationStore.getState().allConversationMessages, 'request-1'));
  expect(visible()).toEqual([]);
});
