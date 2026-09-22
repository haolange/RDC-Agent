import { useCallback } from 'react';
import type { PlanReviewDecision } from '@shared/types/planReview';
import type { PendingPlanReviewRequest } from './planReviewRequestModel';
import { isPlanReviewContinuationCurrent } from './planReviewRequestModel';
import { useElectronApi } from '../../hooks/useElectronApi';
import { useProjectStore } from '../../stores/projectStore';
import { useConversationStore } from '../../stores/conversationStore';
import { useComposerSessionContextStore } from '../../stores/composerSessionContextStore';

export const usePlanReviewSubmit = () => {
  const api = useElectronApi();
  return useCallback(async (
  request: PendingPlanReviewRequest,
  decision: PlanReviewDecision,
): Promise<void> => {
  if (!api) {
    throw new Error('Conversation API is not available.');
  }
  const isCurrent = () => useProjectStore.getState().currentSession?.sessionId === request.sessionId
    && isPlanReviewContinuationCurrent(useConversationStore.getState().conversationMessages, request);
  let invalidated = !isCurrent();
  if (invalidated) return;
  const invalidate = () => { if (!isCurrent()) invalidated = true; };
  const offSession = useProjectStore.subscribe(invalidate);
  const offConversation = useConversationStore.subscribe(invalidate);
  try {
    const result = await api.conversation.answerPlanReview({
      sessionId: request.sessionId, turnId: request.turnId, toolCallId: request.toolCallId, decision,
    });
    if (!result.success) throw new Error(result.error || 'Unable to submit the plan review.');
    if (!invalidated && isCurrent() && decision.kind === 'approve' && request.sessionId) {
      useComposerSessionContextStore.getState().queueHandoffSuggestion({
        sessionId: request.sessionId, agentId: decision.handoff.agent,
        label: decision.handoff.label, prompt: '', send: true,
      });
    }
  } finally {
    offSession();
    offConversation();
  }
  }, [api]);
};
