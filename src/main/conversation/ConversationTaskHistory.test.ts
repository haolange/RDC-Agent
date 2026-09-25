import { expect, it, vi } from 'vitest';
import type { ConversationMessage, ConversationWorkTrace } from '@shared/types/conversation';
import { createAgentEventHandler } from './ConversationTurnAgentEventHandler';
import { upsertWorkBlock } from './ConversationWorkTrace';

it('keeps one immutable Task card per event and deduplicates replay by event ID', () => {
  const message = {
    id: 'assistant-1', sessionId: 'session-1', turnId: 'turn-1', role: 'assistant',
    status: 'streaming', content: '', createdAt: 1, updatedAt: 1,
  } as ConversationMessage;
  const state = { assistantMessage: message };
  const host = { emitConversationEvent: vi.fn() };
  const commit = vi.fn((_type, patch: Partial<ConversationMessage>) => {
    state.assistantMessage = { ...state.assistantMessage, ...patch };
  });
  const handler = createAgentEventHandler({
    host, sessionId: 'session-1', input: { userMessage: {} }, turnStreamState: state,
    commitAssistantMessage: commit,
  } as unknown as Parameters<typeof createAgentEventHandler>[0]);
  const emit = (id: string, type: 'task.created' | 'task.updated', statuses: Array<'pending' | 'completed'>) => handler({
    id, type, sessionId: 'session-1', timestamp: id === 'created' ? 10 : 30,
    payload: {
      taskId: 'task-a', title: 'First', status: statuses[0],
      snapshot: statuses.map((status, order) => ({
        taskId: `task-${order}`, title: `Task ${order}`, status, order,
      })),
    },
  });

  emit('created', 'task.created', ['pending', 'pending']);
  state.assistantMessage.workTrace = upsertWorkBlock(state.assistantMessage.workTrace, 'between', {
    kind: 'llm_turn', title: 'LLM turn', status: 'complete',
  });
  emit('updated', 'task.updated', ['completed', 'pending']);
  emit('updated', 'task.updated', ['completed', 'pending']);
  const blocks = (state.assistantMessage.workTrace as ConversationWorkTrace).blocks;
  expect(blocks.map((block) => block.id)).toEqual(['task-snapshot-created', 'between', 'task-snapshot-updated']);
  expect(blocks[0].taskSnapshot).toMatchObject({ change: 'created', completed: 0,
    items: [{ status: 'pending' }, { status: 'pending' }] });
  expect(blocks[2].taskSnapshot).toMatchObject({ change: 'updated', completed: 1,
    items: [{ status: 'completed' }, { status: 'pending' }] });
  expect(blocks[0].taskSnapshot?.items[0]?.status).toBe('pending');
});
