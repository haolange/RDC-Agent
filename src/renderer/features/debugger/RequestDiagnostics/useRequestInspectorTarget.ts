import { useMemo } from 'react';
import { useConversationStore } from '../../../stores/conversationStore';
import { useProjectStore } from '../../../stores/projectStore';

export function useRequestInspectorTarget(): {
  sessionId: string | null;
  sessionTitle: string | null;
  turnId: string | null;
  active: boolean;
} {
  const currentSession = useProjectStore((state) => state.currentSession);
  const conversationMessages = useConversationStore((state) => state.conversationMessages);
  const sessionId = currentSession?.sessionId ?? null;
  const sessionTitle = currentSession?.title ?? null;

  return useMemo(() => {
    if (!sessionId) {
      return { sessionId: null, sessionTitle: null, turnId: null, active: false };
    }
    for (let index = conversationMessages.length - 1; index >= 0; index -= 1) {
      const message = conversationMessages[index];
      if (
        message?.turnId
        && (message.sessionId == null || message.sessionId === sessionId)
      ) {
        return {
          sessionId,
          sessionTitle,
          turnId: message.turnId,
          active: message.role === 'assistant' && message.workTrace?.status === 'running',
        };
      }
    }
    return { sessionId, sessionTitle, turnId: null, active: false };
  }, [conversationMessages, sessionId, sessionTitle]);
}
