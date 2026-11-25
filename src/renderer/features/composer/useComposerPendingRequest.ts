import { useMemo } from 'react';
import { useConversationStore } from '../../stores/conversationStore';
import { usePlanReviewStore } from '../../stores/planReviewStore';
import { useProjectStore } from '../../stores/projectStore';
import { resolveComposerPendingRequest } from './pendingRequestSelection';

export function useComposerPendingRequest() {
  const messages = useConversationStore((state) => state.conversationMessages);
  const sessionId = useProjectStore(state => state.currentSessionId);
  const plan = usePlanReviewStore(state => sessionId ? state.bySession[sessionId]?.review : null);
  return useMemo(() => resolveComposerPendingRequest(messages, plan), [messages, plan]);
}
