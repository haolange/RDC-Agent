import type { ConversationMessage } from '@shared/types/conversation';
import { agentToolApprovalRequestService } from '../agent-runtime/permissions/AgentToolApprovalRequestService';
import { agentUserInputRequestService } from '../agent-runtime/interactions/AgentUserInputRequestService';

/** Persisted requests do not resurrect approval authority after restart. */
export function reconcileDelegatedInteractionRequests(sessionId: string, message: ConversationMessage): ConversationMessage {
  let changed = false;
  const blocks = message.workTrace?.blocks.map((block) => ({ ...block, toolCalls: block.toolCalls.map((call) => {
    const origin = call.delegatedRequest;
    if (!origin) return call;
    const pendingApproval = call.approval?.status === 'pending';
    const pendingInput = call.toolName === 'ask_user' && (call.status === 'pending' || call.status === 'running') && !call.resultPreview;
    if (!pendingApproval && !pendingInput) return call;
    const live = pendingApproval
      ? agentToolApprovalRequestService.isPending(sessionId, origin.turnId, call.approval!.approvalId)
      : agentUserInputRequestService.isPending(sessionId, origin.turnId, origin.toolCallId);
    if (live) return call;
    changed = true;
    return { ...call, status: 'error' as const, resultPreview: 'Child request was interrupted or cancelled. Explicit recovery is required.', approval: call.approval ? { ...call.approval, status: 'cancelled' as const } : undefined };
  }) }));
  return changed ? { ...message, workTrace: { ...message.workTrace!, blocks: blocks!, updatedAt: Date.now() }, updatedAt: Date.now() } : message;
}
