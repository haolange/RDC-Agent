import type { ConversationMessage, ConversationStreamEvent } from '../types/conversation';

export type MessageUpdateType = 'message_patched' | 'message_completed' | 'message_errored';

/**
 * A whole-message update inside main. Streaming (`message_patched`) updates leave main as deltas
 * (`WorkflowProjectionPublisher`, `messageDelta.ts`); terminal updates are sent whole.
 */
export function buildMessageUpdateEvent(
  type: MessageUpdateType,
  sessionId: string | null,
  message: ConversationMessage,
): ConversationStreamEvent {
  return { type, sessionId: sessionId ?? '', turnId: message.turnId, message } as ConversationStreamEvent;
}
