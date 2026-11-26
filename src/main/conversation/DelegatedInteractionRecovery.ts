import { isAutomaticToolApproval } from '@shared/utils/toolApproval';
import { agentToolApprovalRequestService } from '../agent-runtime/permissions/AgentToolApprovalRequestService';
import { agentUserInputRequestService } from '../agent-runtime/interactions/AgentUserInputRequestService';
import { agentPlanReviewRequestService } from '../agent-runtime/interactions/AgentPlanReviewRequestService';
import { finalizeTrace } from '../agent-runtime/workTrace/ConversationWorkTrace';
import { interruptionCauseAt } from '../runtime/previousInstanceDiagnosis';
import type { ConversationMessage } from '@shared/types/conversation';

/** Persisted requests do not resurrect approval authority after restart. */
export function reconcileDelegatedInteractionRequests(
  sessionId: string,
  message: ConversationMessage,
): ConversationMessage {
  let changed = false as boolean;
  const blocks = message.workTrace?.blocks.map((block) => ({
    ...block,
    toolCalls: block.toolCalls.map((call) => {
      const origin = call.delegatedRequest;
      if (!origin && call.toolName !== 'plan_artifact') return call;
      if (
        call.toolName === 'plan_artifact' &&
        call.planReview?.status === 'awaiting' &&
        (message.status === 'stopped' || message.status === 'error')
      ) {
        changed = true;
        return { ...call, planReview: { ...call.planReview, status: 'cancelled' as const } };
      }
      const pendingApproval = call.approval?.status === 'pending';
      if (pendingApproval && isAutomaticToolApproval(call.approval!)) return call;
      const pendingInput =
        call.toolName === 'ask_user' && (call.status === 'pending' || call.status === 'running') && !call.resultPreview;
      const pendingPlan =
        call.toolName === 'plan_artifact' &&
        (call.status === 'pending' || call.status === 'running') &&
        call.planReview?.status === 'awaiting';
      if (!pendingApproval && !pendingInput && !pendingPlan) return call;
      const live = pendingApproval
        ? agentToolApprovalRequestService.isPending(sessionId, origin!.turnId, call.approval!.approvalId)
        : pendingPlan
          ? agentPlanReviewRequestService.isPending(
              sessionId,
              origin?.turnId ?? message.turnId,
              origin?.toolCallId ?? call.id,
            )
          : agentUserInputRequestService.isPending(sessionId, origin!.turnId, origin!.toolCallId);
      if (live) return call;
      changed = true;
      return {
        ...call,
        status: 'error' as const,
        planReview: call.planReview ? { ...call.planReview, status: 'cancelled' as const } : undefined,
        resultPreview: 'Child request was interrupted or cancelled. Explicit recovery is required.',
        approval: call.approval ? { ...call.approval, status: 'cancelled' as const } : undefined,
      };
    }),
  }));
  return changed
    ? {
        ...message,
        workTrace: { ...message.workTrace!, blocks: blocks!, updatedAt: Date.now() },
        updatedAt: Date.now(),
      }
    : message;
}

/**
 * A persisted streaming turn has no producer after restart. Keep its evidence, but settle its UI state. The diagnostic
 * names how the launch that ran it ended, when that is the previous launch this one diagnosed; the renderer words it.
 */
export function reconcileInterruptedConversationTurn(
  message: ConversationMessage,
  isActive: boolean,
  lastObservedAt = message.updatedAt,
): ConversationMessage {
  if (isActive || message.role !== 'assistant' || (message.status !== 'draft' && message.status !== 'streaming')) {
    return message;
  }
  const recoveredAt = Date.now();
  const cause = interruptionCauseAt(message.createdAt);
  return {
    ...message,
    status: 'error',
    updatedAt: recoveredAt,
    diagnostic: {
      code: 'CONVERSATION_INTERRUPTED',
      severity: 'error',
      userMessage: `The request was interrupted when the app stopped (${cause}); send it again.`,
      interruption: { cause },
    },
    workTrace: message.workTrace ? finalizeTrace(message.workTrace, 'error', undefined, lastObservedAt) : undefined,
  };
}
