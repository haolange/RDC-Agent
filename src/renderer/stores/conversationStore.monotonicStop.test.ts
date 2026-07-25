import { beforeEach, describe, expect, it } from 'vitest';
import type { ConversationMessage } from '@shared/types/conversation';
import {
  shouldRejectActivePatchForMonotonicStop,
  useConversationStore,
} from './conversationStore';

const baseAssistant = (overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  id: 'assistant-1',
  turnId: 'turn-1',
  sessionId: 'session-1',
  projectId: null,
  role: 'assistant',
  content: 'partial',
  status: 'streaming',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('conversationStore monotonic stop', () => {
  beforeEach(() => {
    useConversationStore.getState().reset();
  });

  it('rejects late streaming patches for monotonically stopped turns', () => {
    const stopped = new Set(['turn-1']);
    expect(shouldRejectActivePatchForMonotonicStop(
      baseAssistant({ status: 'streaming', updatedAt: 99 }),
      stopped,
    )).toBe(true);
    expect(shouldRejectActivePatchForMonotonicStop(
      baseAssistant({ status: 'stopped', updatedAt: 99, content: 'final stop' }),
      stopped,
    )).toBe(false);
  });

  it('upsertConversationMessage keeps stopped over later streaming when marked', () => {
    const store = useConversationStore.getState();
    store.upsertConversationMessage(baseAssistant({ status: 'streaming', updatedAt: 1 }));
    store.markTurnMonotonicallyStopped('turn-1');
    store.updateAssistantMessageByTurnId('turn-1', (message) => ({
      ...message,
      status: 'stopped',
      updatedAt: 2,
      content: 'stopped locally',
    }));
    store.upsertConversationMessage(baseAssistant({
      status: 'streaming',
      updatedAt: 100,
      content: 'late stream',
    }));

    const assistant = useConversationStore.getState().conversationMessages.find((m) => m.id === 'assistant-1');
    expect(assistant?.status).toBe('stopped');
    expect(assistant?.content).toBe('stopped locally');
  });

  it('consumeRevokedRequest is single-shot', () => {
    const store = useConversationStore.getState();
    store.markRequestRevoked('req-1');
    expect(store.consumeRevokedRequest('req-1')).toBe(true);
    expect(useConversationStore.getState().consumeRevokedRequest('req-1')).toBe(false);
  });
});
