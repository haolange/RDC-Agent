import { useMemo } from 'react';
import { useConversationStore } from '../../stores/conversationStore';
import { resolveComposerPendingRequest } from './pendingRequestSelection';

export function useComposerPendingRequest() {
  const messages = useConversationStore((state) => state.conversationMessages);
  return useMemo(() => resolveComposerPendingRequest(messages), [messages]);
}
