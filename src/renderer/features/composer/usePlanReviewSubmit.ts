import { useCallback } from 'react';
import type { PlanReviewDecision } from '@shared/types/planReview';
import type { PendingPlanReviewRequest } from './planReviewRequestModel';

export const usePlanReviewSubmit = () => useCallback(async (
  request: PendingPlanReviewRequest,
  decision: PlanReviewDecision,
): Promise<void> => {
  const electronAPI = window.electronAPI;
  if (!electronAPI) {
    throw new Error('Conversation API is not available.');
  }
  const result = await electronAPI.conversation.answerPlanReview({
    sessionId: request.sessionId,
    turnId: request.turnId,
    toolCallId: request.toolCallId,
    decision,
  });
  if (!result.success) {
    throw new Error(result.error || 'Unable to submit the plan review.');
  }
}, []);
