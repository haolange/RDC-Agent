import { useConversationStore } from '../stores/conversationStore';
import { ACTIVE_ASSISTANT_STATUSES } from '../stores/conversationStoreModel';
import { useProjectStore } from '../stores/projectStore';
import { useSessionProjectionStore } from '../stores/sessionProjectionStore';
import type { ConversationMessage } from '@shared/types/conversation';

const hasReplyInFlight = (messages: readonly ConversationMessage[]): boolean => messages
  .some((message) => message.role === 'assistant' && ACTIVE_ASSISTANT_STATUSES.has(message.status));

/**
 * Whether a session has a reply in flight: the open session reads the live conversation, every other session reads
 * the projection that background conversation events keep current.
 */
export function useSessionRunning(sessionId: string): boolean {
  const openSessionId = useProjectStore((state) => state.currentSession?.sessionId ?? null);
  const live = useConversationStore((state) => openSessionId === sessionId && hasReplyInFlight(state.allConversationMessages));
  const background = useSessionProjectionStore((state) => openSessionId !== sessionId
    && hasReplyInFlight(state.bySessionId[sessionId]?.allMessages ?? []));
  return live || background;
}
