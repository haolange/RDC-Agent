import type { ConversationMessage } from '@shared/types/conversation';
import { agentToolApprovalRequestService } from '../agent-runtime/permissions/AgentToolApprovalRequestService';
import { agentUserInputRequestService } from '../agent-runtime/interactions/AgentUserInputRequestService';
import { agentPlanReviewRequestService } from '../agent-runtime/interactions/AgentPlanReviewRequestService';

/** Persisted requests do not resurrect approval authority after restart. */
export function reconcileDelegatedInteractionRequests(sessionId: string, message: ConversationMessage): ConversationMessage {
  let changed = false;
  const blocks = message.workTrace?.blocks.map((block) => ({ ...block, toolCalls: block.toolCalls.map((call) => {
    const origin = call.delegatedRequest;
    if (!origin && call.toolName !== 'plan_artifact') return call;
    const pendingApproval = call.approval?.status === 'pending';
    const pendingInput = call.toolName === 'ask_user' && (call.status === 'pending' || call.status === 'running') && !call.resultPreview;
    const pendingPlan = call.toolName === 'plan_artifact' && (call.status === 'pending' || call.status === 'running') && call.planReview?.status === 'awaiting';
    if (!pendingApproval && !pendingInput && !pendingPlan) return call;
    const live = pendingApproval
      ? agentToolApprovalRequestService.isPending(sessionId, origin!.turnId, call.approval!.approvalId)
      : pendingPlan
        ? agentPlanReviewRequestService.isPending(sessionId, origin?.turnId ?? message.turnId, origin?.toolCallId ?? call.id)
        : agentUserInputRequestService.isPending(sessionId, origin!.turnId, origin!.toolCallId);
    if (live) return call;
    changed = true;
    return { ...call, status: 'error' as const, planReview: call.planReview ? { ...call.planReview, status: 'rejected' as const } : undefined, resultPreview: 'Child request was interrupted or cancelled. Explicit recovery is required.', approval: call.approval ? { ...call.approval, status: 'cancelled' as const } : undefined };
  }) }));
  return changed ? { ...message, workTrace: { ...message.workTrace!, blocks: blocks!, updatedAt: Date.now() }, updatedAt: Date.now() } : message;
}
