import { applyConversationMessageDelta } from '@shared/conversation/messageDelta';
import type { ConversationMessage, ConversationStreamEvent } from '@shared/types/conversation';

type MessagePatchedEvent = Extract<ConversationStreamEvent, { type: 'message_patched' }>;

export interface ConversationMessageAssemblerOptions {
  requestSnapshot: (sessionId: string, messageId: string) => Promise<{ seq: number; message: ConversationMessage } | null>;
  /** Receives a message rebuilt from a snapshot after the stream was resumed. */
  deliver: (event: MessagePatchedEvent) => void;
}

/**
 * Rebuilds whole messages from main's streamed deltas, so everything downstream keeps handling `message_patched`
 * events. Only messages that are still streaming are held. A delta that does not build on the last applied update
 * (the renderer reloaded mid-turn, or missed one) is dropped and the stream resumes from a snapshot.
 */
export function createConversationMessageAssembler(options: ConversationMessageAssemblerOptions) {
  const streams = new Map<string, { seq: number; message: ConversationMessage }>();
  const resuming = new Set<string>();

  const resume = (sessionId: string, messageId: string) => {
    if (resuming.has(messageId)) return;
    resuming.add(messageId);
    void options.requestSnapshot(sessionId, messageId)
      .then((snapshot) => {
        if (!snapshot || (streams.get(messageId)?.seq ?? 0) >= snapshot.seq) return;
        streams.set(messageId, snapshot);
        options.deliver({ type: 'message_patched', sessionId, turnId: snapshot.message.turnId, message: snapshot.message });
      })
      // A failed request is retried by the next delta of the same message; the terminal event is always whole.
      .catch((error: unknown) => console.warn('[conversation] could not resume a streamed message', error))
      .finally(() => resuming.delete(messageId));
  };

  return {
    /** The event to handle in place of `event`, or `null` when it is consumed (an out-of-sequence delta). */
    accept(event: ConversationStreamEvent): ConversationStreamEvent | null {
      if (event.type === 'message_delta') {
        const { delta } = event;
        const stream = streams.get(delta.messageId);
        if (delta.baseSeq !== 0 && stream?.seq !== delta.baseSeq) {
          resume(event.sessionId, delta.messageId);
          return null;
        }
        const message = applyConversationMessageDelta(stream?.message, delta);
        streams.set(delta.messageId, { seq: delta.seq, message });
        return { type: 'message_patched', sessionId: event.sessionId, turnId: event.turnId, message };
      }
      if (event.type === 'message_completed' || event.type === 'message_errored') streams.delete(event.message.id);
      return event;
    },
    dispose() {
      streams.clear();
    },
  };
}
