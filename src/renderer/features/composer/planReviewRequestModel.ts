import type { ConversationMessage, ConversationPlanReview } from '@shared/types/conversation';

export interface PendingPlanReviewRequest {
  sessionId: string | null;
  turnId: string;
  toolCallId: string;
  planReview: ConversationPlanReview;
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
