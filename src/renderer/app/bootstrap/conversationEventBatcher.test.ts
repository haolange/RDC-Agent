import { describe, expect, it, vi } from 'vitest';
import type { ConversationMessage, ConversationStreamEvent } from '@shared/types/conversation';
import { createConversationEventBatcher } from './conversationEventBatcher';

const message = (id: string, content: string, updatedAt: number): ConversationMessage => ({
  id,
  turnId: 'turn-1',
  sessionId: 'session-1',
  projectId: null,
  role: 'assistant',
  content,
  status: 'streaming',
  createdAt: 1,
  updatedAt,
});

describe('conversationEventBatcher', () => {
  it('coalesces patched events to one apply per frame', () => {
    const applied: ConversationStreamEvent[] = [];
    const scheduled: Array<() => void> = [];
    const batcher = createConversationEventBatcher({
      applyMessage: (event) => applied.push(event),
      schedule: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      cancel: vi.fn(),
    });

    batcher.handle({
      type: 'message_patched',
      sessionId: 'session-1',
      turnId: 'turn-1',
      message: message('a1', 'a', 1),
    });
    batcher.handle({
      type: 'message_patched',
      sessionId: 'session-1',
      turnId: 'turn-1',
      message: message('a1', 'ab', 2),
    });
    expect(applied).toHaveLength(0);
    scheduled[0]?.();
    expect(applied).toHaveLength(1);
    expect((applied[0] as { message: ConversationMessage }).message.content).toBe('ab');
  });

  it('flushes pending patched state before terminal events', () => {
    const applied: string[] = [];
    const scheduled: Array<() => void> = [];
    const batcher = createConversationEventBatcher({
      applyMessage: (event) => applied.push(`${event.type}:${event.message.content}`),
      schedule: (callback) => {
        scheduled.push(callback);
        return scheduled.length;
      },
      cancel: vi.fn(),
    });

    batcher.handle({
      type: 'message_patched',
      sessionId: 'session-1',
      turnId: 'turn-1',
      message: message('a1', 'partial', 1),
    });
    batcher.handle({
      type: 'message_completed',
      sessionId: 'session-1',
      turnId: 'turn-1',
      message: { ...message('a1', 'final', 3), status: 'complete' },
    });

    expect(applied).toEqual([
      'message_patched:partial',
      'message_completed:final',
    ]);
    expect(scheduled).toHaveLength(1);
  });
});
