import type { ConversationMessage, ConversationPlanReview } from '@shared/types/conversation';

export interface PendingPlanReviewRequest {
  sessionId: string | null;
  turnId: string;
  toolCallId: string;
  planReview: ConversationPlanReview;
}

export const planReviewRequestKey = (request: PendingPlanReviewRequest): string => JSON.stringify([
  request.sessionId, request.turnId, request.toolCallId,
  request.planReview.planId, request.planReview.revision, request.planReview.hash,
]);

/** Approval may remove the gate before IPC resolves; the matching approved trace is still valid. */
export function isPlanReviewContinuationCurrent(messages: ConversationMessage[], request: PendingPlanReviewRequest): boolean {
  const pending = findPendingPlanReview(messages);
  if (pending && planReviewRequestKey(pending) !== planReviewRequestKey(request)) return false;
  return messages.some((message) => message.sessionId === request.sessionId
    && message.status !== 'stopped' && message.status !== 'error'
    && message.workTrace?.blocks.some((block) => block.toolCalls.some((call) => {
      const plan = call.planReview;
      return (call.delegatedRequest?.turnId ?? message.turnId) === request.turnId
        && (call.delegatedRequest?.toolCallId ?? call.id) === request.toolCallId
        && !!plan && plan.planId === request.planReview.planId
        && plan.revision === request.planReview.revision && plan.hash === request.planReview.hash
        && (plan.status === 'approved' || (plan.status === 'awaiting' && (call.status === 'running' || call.status === 'pending')));
    })));
}

const normalizeToolName = (toolName: string): string => toolName.trim().toLowerCase().replace(/[.-]/g, '_');

export const findPendingPlanReview = (messages: ConversationMessage[]): PendingPlanReviewRequest | null => {
  const assistantMessages = messages
    .filter((message) => (
      message.role === 'assistant'
      && (message.status === 'draft' || message.status === 'streaming' || message.workTrace?.blocks.some((block) => (
        block.toolCalls.some((call) => call.delegatedRequest && (call.status === 'running' || call.status === 'pending'))
      )))
    ))
    .sort((left, right) => right.createdAt - left.createdAt);

  for (const message of assistantMessages) {
    for (const block of message.workTrace?.blocks ?? []) {
      for (const call of block.toolCalls) {
        if (normalizeToolName(call.toolName) !== 'plan_artifact') continue;
        if (call.status !== 'pending' && call.status !== 'running') continue;
        if (call.planReview?.status !== 'awaiting') continue;
        return {
          sessionId: message.sessionId,
          turnId: call.delegatedRequest?.turnId ?? message.turnId,
          toolCallId: call.delegatedRequest?.toolCallId ?? call.id,
          planReview: call.planReview,
        };
      }
    }
  }

  return null;
};
