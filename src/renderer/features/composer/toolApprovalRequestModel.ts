import { isAutomaticToolApproval } from '@shared/utils/toolApproval';
import type { ConversationMessage } from '@shared/types/conversation';
import type { AdmissionCheck } from '@shared/constants/admissionChecks';

export interface PendingToolApprovalRequest {
  sessionId: string | null;
  turnId: string;
  approvalId: string;
  toolCallId?: string;
  toolName: string;
  question: string;
  risk: 'low' | 'medium' | 'high';
  reviewer?: string;
  /** The checks an auto-review could not establish before handing this action to the user. */
  escalatedChecks?: AdmissionCheck[];
}

export const findPendingToolApproval = (messages: ConversationMessage[]): PendingToolApprovalRequest | null => {
  const assistantMessages = messages
    .filter(
      (message) =>
        message.role === 'assistant' &&
        (message.status === 'draft' ||
          message.status === 'streaming' ||
          message.workTrace?.blocks.some((block) =>
            block.toolCalls.some((call) => call.delegatedRequest && call.approval?.status === 'pending'),
          )),
    )
    .sort((left, right) => right.createdAt - left.createdAt);

  for (const message of assistantMessages) {
    for (const block of message.workTrace?.blocks ?? []) {
      for (const toolCall of block.toolCalls) {
        if (toolCall.approval?.status !== 'pending' || isAutomaticToolApproval(toolCall.approval)) continue;
        return {
          sessionId: message.sessionId,
          turnId: toolCall.delegatedRequest?.turnId ?? message.turnId,
          approvalId: toolCall.approval.approvalId,
          toolCallId: toolCall.id,
          toolName: toolCall.toolName,
          question: toolCall.approval.reason?.trim() || block.summary?.trim() || '',
          risk: (toolCall.approval.risk === 'low' || toolCall.approval.risk === 'high'
            ? toolCall.approval.risk
            : 'medium') as PendingToolApprovalRequest['risk'],
          reviewer: toolCall.approval.reviewer,
          ...(toolCall.approval.escalatedFrom ? { escalatedChecks: toolCall.approval.escalatedFrom.failedChecks } : {}),
        };
      }
    }
  }

  return null;
};
