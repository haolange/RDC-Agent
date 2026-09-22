import type { ConversationMessage } from '@shared/types/conversation';

export interface PendingToolApprovalRequest {
  sessionId: string | null;
  turnId: string;
  approvalId: string;
  toolCallId?: string;
  toolName: string;
  question: string;
  risk: 'low' | 'medium' | 'high';
  reviewer?: string;
}

export const findPendingToolApproval = (messages: ConversationMessage[]): PendingToolApprovalRequest | null => {
  const assistantMessages = messages
    .filter((message) => message.role === 'assistant' && (message.status === 'draft' || message.status === 'streaming' || message.workTrace?.blocks.some((block) => block.toolCalls.some((call) => call.delegatedRequest && call.approval?.status === 'pending'))))
    .sort((left, right) => right.createdAt - left.createdAt);

  for (const message of assistantMessages) {
    for (const block of message.workTrace?.blocks ?? []) {
      for (const toolCall of block.toolCalls) {
        if (toolCall.approval?.status !== 'pending') continue;
        return {
          sessionId: message.sessionId,
          turnId: toolCall.delegatedRequest?.turnId ?? message.turnId,
          approvalId: toolCall.approval.approvalId,
          toolCallId: toolCall.id,
          toolName: toolCall.toolName,
          question: toolCall.approval.reason?.trim()
            || block.summary?.trim()
            || 'The agent needs approval before continuing.',
          risk: (toolCall.approval.risk === 'low' || toolCall.approval.risk === 'high'
            ? toolCall.approval.risk
            : 'medium') as PendingToolApprovalRequest['risk'],
          reviewer: toolCall.approval.reviewer,
        };
      }
    }
  }

  return null;
};
