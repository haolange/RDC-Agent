import type { ConversationToolCall, ConversationWorkTrace } from '@shared/types/conversation';
import type { PlanReviewDecision } from '@shared/types/planReview';
import { nowMs } from '@shared/utils/id';
import { normalizeToolName } from '../workflow/debugger/DebuggerRuntimePolicy';
import { supersedePreviousPlanReviews, upsertRuntimeToolCall } from './ConversationWorkTrace';

export function isPlanReviewApprovalPayload(payload: { kind?: string; toolName?: string }): boolean {
  return payload.kind === 'plan_review' || normalizeToolName(String(payload.toolName ?? '')) === 'plan_artifact';
}

export function applyPlanReviewRequested(input: {
  payload: {
    approvalId?: string;
    toolCallId?: string;
    planReview?: ConversationToolCall['planReview'];
  };
  workTrace: ConversationWorkTrace | null | undefined;
}): ConversationWorkTrace | null {
  const planReview = input.payload.planReview;
  if (!planReview) return input.workTrace ?? null;
  const toolCallId = String(input.payload.toolCallId ?? input.payload.approvalId ?? `approval-${input.payload.toolCallId ?? 'runtime'}`);
  return upsertRuntimeToolCall(
    supersedePreviousPlanReviews(input.workTrace, toolCallId),
    {
      id: toolCallId,
      toolName: 'plan_artifact',
      status: 'running',
      planReview,
      argsPreview: [planReview.title, ...planReview.summary].join(' | ').slice(0, 600),
      startedAt: nowMs(),
    },
  );
}

export function applyPlanReviewAnswered(input: {
  payload: {
    approvalId?: string;
    status?: string;
    answer?: unknown;
    toolCallId?: string;
    planReview?: ConversationToolCall['planReview'];
    decision?: PlanReviewDecision;
  };
  workTrace: ConversationWorkTrace | null | undefined;
}): ConversationWorkTrace | null {
  const approvalId = input.payload.approvalId ?? 'runtime';
  const cancelled = input.payload.status === 'cancelled';
  const existing = input.workTrace?.blocks
    .flatMap((block) => block.toolCalls)
    .find((call) => call.id === String(input.payload.toolCallId ?? approvalId));
  const planReview = input.payload.planReview ?? existing?.planReview;
  return upsertRuntimeToolCall(input.workTrace, {
    id: String(input.payload.toolCallId ?? approvalId),
    toolName: 'plan_artifact',
    status: cancelled ? 'error' : 'running',
    planReview: planReview
      ? {
          ...planReview,
          status: cancelled
            ? 'rejected'
            : (input.payload.decision?.kind === 'approve' ? 'approved' : input.payload.decision?.kind === 'reject' ? 'rejected' : planReview.status),
          decision: input.payload.decision ?? planReview.decision,
        }
      : undefined,
    resultPreview: cancelled
      ? String(input.payload.answer ?? 'Plan review request was cancelled.')
      : input.payload.decision?.kind === 'reject'
        ? input.payload.decision.feedback
        : existing?.resultPreview,
    error: cancelled ? String(input.payload.answer ?? 'Plan review request was cancelled.') : undefined,
    completedAt: cancelled ? nowMs() : undefined,
  });
}
