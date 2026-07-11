import { useMemo } from 'react';
import { useConversationStore } from '../../../stores/conversationStore';
import { useProjectStore } from '../../../stores/projectStore';

export function useRequestInspectorTarget(): {
  sessionId: string | null;
  turnId: string | null;
  active: boolean;
} {
  const currentSession = useProjectStore((state) => state.currentSession);
  const conversationMessages = useConversationStore((state) => state.conversationMessages);
  const sessionId = currentSession?.sessionId ?? null;

  return useMemo(() => {
    if (!sessionId) {
      return { sessionId: null, turnId: null, active: false };
    }
    for (let index = conversationMessages.length - 1; index >= 0; index -= 1) {
      const message = conversationMessages[index];
      if (
        message?.role === 'assistant'
        && message.turnId
        && (message.sessionId == null || message.sessionId === sessionId)
      ) {
        return {
          sessionId,
          turnId: message.turnId,
          active: message.workTrace?.status === 'running',
        };
      }
    }
    return { sessionId, turnId: null, active: false };
  }, [conversationMessages, sessionId]);
}
