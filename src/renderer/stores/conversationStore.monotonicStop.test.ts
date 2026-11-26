import { beforeEach, describe, expect, it } from 'vitest';
import { conversationTurnIds } from '@shared/conversation/conversationTurnIds';
import { stopWorkTrace } from '../lib/stopWorkTrace';
import { shouldRejectActivePatchForMonotonicStop, useConversationStore } from './conversationStore';
import type { ConversationMessage } from '@shared/types/conversation';

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
    expect(
      shouldRejectActivePatchForMonotonicStop(baseAssistant({ status: 'streaming', updatedAt: 99 }), stopped),
    ).toBe(true);
    expect(
      shouldRejectActivePatchForMonotonicStop(
        baseAssistant({ status: 'stopped', updatedAt: 99, content: 'final stop' }),
        stopped,
      ),
    ).toBe(false);
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
    store.upsertConversationMessage(
      baseAssistant({
        status: 'streaming',
        updatedAt: 100,
        content: 'late stream',
      }),
    );

    const assistant = useConversationStore.getState().conversationMessages.find((m) => m.id === 'assistant-1');
    expect(assistant?.status).toBe('stopped');
    expect(assistant?.content).toBe('stopped locally');
  });

  it('accepts the authoritative terminal trace after an optimistic stop', () => {
    const store = useConversationStore.getState();
    store.upsertConversationMessage(
      baseAssistant({
        workTrace: {
          status: 'running',
          updatedAt: 1,
          blocks: [
            {
              id: 'loop',
              kind: 'llm_turn',
              title: 'Loop',
              status: 'running',
              startedAt: 1,
              toolCalls: [{ id: 'pending', toolName: 'investigation_read', status: 'pending', startedAt: 1 }],
            },
          ],
        },
      }),
    );
    store.markTurnMonotonicallyStopped('turn-1');
    store.updateAssistantMessageByTurnId('turn-1', stopWorkTrace);
    expect(useConversationStore.getState().conversationMessages[0].workTrace?.blocks[0].toolCalls[0].status).toBe(
      'skipped',
    );

    store.upsertConversationMessage(
      baseAssistant({
        status: 'stopped',
        updatedAt: 2,
        workTrace: {
          status: 'stopped',
          updatedAt: 2,
          blocks: [
            {
              id: 'loop',
              kind: 'llm_turn',
              title: 'Loop',
              status: 'complete',
              startedAt: 1,
              toolCalls: [
                { id: 'pending', toolName: 'investigation_read', status: 'complete', startedAt: 1, completedAt: 2 },
              ],
            },
          ],
        },
      }),
    );
    expect(useConversationStore.getState().conversationMessages[0].workTrace?.blocks[0].toolCalls[0].status).toBe(
      'complete',
    );
  });

  it('consumeRevokedRequest is single-shot', () => {
    const store = useConversationStore.getState();
    store.markRequestRevoked('req-1');
    expect(store.consumeRevokedRequest('req-1')).toBe(true);
    expect(useConversationStore.getState().consumeRevokedRequest('req-1')).toBe(false);
  });

  it("keeps a request stopped before main answered stopped when main's message for it arrives late", () => {
    const store = useConversationStore.getState();
    const { turnId, assistantMessageId } = conversationTurnIds('req-9');
    store.upsertConversationMessage(
      baseAssistant({
        id: assistantMessageId,
        turnId,
        requestId: 'req-9',
        status: 'streaming',
        updatedAt: 1,
      }),
    );
    store.markRequestMonotonicallyStopped('req-9');
    store.markTurnMonotonicallyStopped(turnId);
    store.updateAssistantMessageByTurnId(turnId, (message) => ({ ...message, status: 'stopped' }));

    // Main's message carries the same ids; a late streaming version of it cannot reopen the stopped turn.
    store.upsertConversationMessage(
      baseAssistant({
        id: assistantMessageId,
        turnId,
        requestId: 'req-9',
        status: 'streaming',
        updatedAt: 100,
        content: 'late after stop',
      }),
    );

    const [message] = useConversationStore.getState().allConversationMessages;
    expect(message).toMatchObject({ id: assistantMessageId, status: 'stopped' });
    expect(message.content).not.toBe('late after stop');
  });
});
