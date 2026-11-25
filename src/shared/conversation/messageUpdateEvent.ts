import type { ConversationMessage, ConversationStreamEvent } from '../types/conversation';

export type MessageUpdateType = 'message_patched' | 'message_completed' | 'message_errored';

/**
 * The event main sends the renderer when an assistant message changes. It currently carries the whole message, so
 * each step's update grows with the length of the work trace; the budget test pins that until updates become deltas.
 */
export function buildMessageUpdateEvent(
  type: MessageUpdateType,
  sessionId: string | null,
  message: ConversationMessage,
): ConversationStreamEvent {
  return { type, sessionId: sessionId ?? '', turnId: message.turnId, message } as ConversationStreamEvent;
}
