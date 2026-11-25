import { beforeEach, expect, it } from 'vitest';
import { buildOptimisticConversationTurn, removeOptimisticConversationMessages } from './conversationSendOptimistic';
import { useConversationStore } from './conversationStore';
import type { ConversationMessage } from '@shared/types/conversation';

const optimistic = () => buildOptimisticConversationTurn({
  requestId: 'request-1', trimmed: 'Find the draw', currentProject: null, currentSession: null,
  currentRun: null, pendingAttachments: [],
});
const fromMain = (role: 'user' | 'assistant', overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: role === 'user' ? 'msgu-1' : 'msga-1', requestId: 'request-1', turnId: 'turn-1', sessionId: 'session-1', projectId: null,
  role, content: role === 'user' ? 'Find the draw' : '', status: role === 'user' ? 'complete' : 'streaming',
  // Main stamps its messages after the renderer built the placeholders.
  createdAt: Date.now() + (role === 'user' ? 1_000 : 1_001), updatedAt: Date.now() + 1_001, ...overrides,
});
const visibleIds = () => useConversationStore.getState().conversationMessages.map((message) => message.id);

beforeEach(() => useConversationStore.getState().reset());

it('lets main\'s message take its placeholder\'s place whichever arrives first, and rolls back an unanswered send', () => {
  const { userMessage, assistantDraftMessage, optimisticIds } = optimistic();
  const store = useConversationStore.getState();
  store.upsertConversationMessages([userMessage, assistantDraftMessage]);
  expect(visibleIds()).toEqual(optimisticIds);
  // A stream event for the assistant can land before the send result: the transcript never shows two replies.
  store.upsertConversationMessages([fromMain('assistant')]);
  expect(visibleIds()).toEqual([userMessage.id, 'msga-1']);
  store.upsertConversationMessages([fromMain('user')]);
  expect(visibleIds()).toEqual(['msgu-1', 'msga-1']);
  // The send result then drops whatever placeholders remain; nothing visible changes.
  store.setConversationMessages(removeOptimisticConversationMessages(useConversationStore.getState().allConversationMessages, optimisticIds));
  expect(visibleIds()).toEqual(['msgu-1', 'msga-1']);

  // A rejected send has no message from main: the rollback removes both placeholders.
  store.reset();
  const failed = optimistic();
  store.upsertConversationMessages([failed.userMessage, failed.assistantDraftMessage]);
  store.setConversationMessages(removeOptimisticConversationMessages(useConversationStore.getState().allConversationMessages, failed.optimisticIds));
  expect(visibleIds()).toEqual([]);
});
