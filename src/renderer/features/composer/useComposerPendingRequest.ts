import { useMemo } from 'react';
import { useConversationStore } from '../../stores/conversationStore';
import { resolveComposerPendingRequest } from './pendingRequestSelection';
import { usePlanReviewStore } from '../../stores/planReviewStore';
import { useProjectStore } from '../../stores/projectStore';

export function useComposerPendingRequest() {
  const messages = useConversationStore((state) => state.conversationMessages);
  const sessionId = useProjectStore(state => state.currentSession?.sessionId);
  const plan = usePlanReviewStore(state => sessionId ? state.bySession[sessionId]?.review : null);
  return useMemo(() => resolveComposerPendingRequest(messages, plan), [messages, plan]);
}
