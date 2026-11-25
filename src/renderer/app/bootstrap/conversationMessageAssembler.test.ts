import { describe, expect, it, vi } from 'vitest';
import { createConversationMessageDeltaEncoder } from '@shared/conversation/messageDelta';
import { createWorkTraceFixture } from '@shared/fixtures/workTraceFixture';
import { createConversationMessageAssembler } from './conversationMessageAssembler';
import type { ConversationMessage, ConversationStreamEvent } from '@shared/types/conversation';

const message = (steps: number): ConversationMessage => ({
  id: 'assistant-a', turnId: 'turn-a', sessionId: 'session-a', projectId: null, role: 'assistant',
  content: '', status: 'streaming', createdAt: 1, updatedAt: steps, workTrace: createWorkTraceFixture({ steps }),
} as ConversationMessage);

const deltaEvent = (encoder: ReturnType<typeof createConversationMessageDeltaEncoder>, steps: number): ConversationStreamEvent => (
  { type: 'message_delta', sessionId: 'session-a', turnId: 'turn-a', delta: encoder.encode(message(steps))! }
);

describe('conversation message assembler', () => {
  it('rebuilds whole messages from a delta sequence', () => {
    const encoder = createConversationMessageDeltaEncoder();
    const assembler = createConversationMessageAssembler({ requestSnapshot: vi.fn(), deliver: vi.fn() });
    for (const steps of [1, 2, 5]) {
      expect(assembler.accept(deltaEvent(encoder, steps))).toEqual({
        type: 'message_patched', sessionId: 'session-a', turnId: 'turn-a', message: message(steps),
      });
    }
  });

  it('resumes from a snapshot when it joins a stream mid-way, and ignores deltas until then', async () => {
    const encoder = createConversationMessageDeltaEncoder();
    deltaEvent(encoder, 1);
    deltaEvent(encoder, 2);
    const deliver = vi.fn();
    const requestSnapshot = vi.fn(async () => encoder.snapshot('assistant-a'));
    const assembler = createConversationMessageAssembler({ requestSnapshot, deliver });

    expect(assembler.accept(deltaEvent(encoder, 3))).toBeNull();
    expect(assembler.accept(deltaEvent(encoder, 4))).toBeNull();
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledOnce());
    // The snapshot was taken when requested (after step 3); the step-4 delta dropped meanwhile makes the next delta
    // miss its base too, so the stream resumes once more and converges on the latest state.
    expect(deliver.mock.calls[0]?.[0].message).toEqual(message(3));
    expect(assembler.accept(deltaEvent(encoder, 6))).toBeNull();
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(2));
    expect(deliver.mock.calls[1]?.[0].message).toEqual(message(6));
    expect(assembler.accept(deltaEvent(encoder, 7))).toMatchObject({ message: message(7) });
  });

  it('ends a stream at its whole terminal event', () => {
    const encoder = createConversationMessageDeltaEncoder();
    const requestSnapshot = vi.fn(async () => null);
    const assembler = createConversationMessageAssembler({ requestSnapshot, deliver: vi.fn() });
    assembler.accept(deltaEvent(encoder, 1));
    const completed: ConversationStreamEvent = { type: 'message_completed', sessionId: 'session-a', turnId: 'turn-a', message: message(2) };
    expect(assembler.accept(completed)).toBe(completed);
    expect(assembler.accept(deltaEvent(encoder, 3))).toBeNull();
    expect(requestSnapshot).toHaveBeenCalledOnce();
  });
});
