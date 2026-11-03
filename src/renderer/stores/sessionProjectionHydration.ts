import type { ConversationMessage } from '@shared/types/conversation';
import type { ConversationBranchState } from '@shared/types/conversationBranch';
import type { PlanReviewProjection } from '@shared/types/planReview';
import type { AgentRunPresentation } from '@shared/types/agenticTrace';
import { useCaptureStore } from './captureStore';
import { useConversationStore } from './conversationStore';
import { usePlanReviewStore } from './planReviewStore';
import { useWorkflowStore } from './workflowStore';
import { useSessionStore } from './sessionStore';
import type { SessionProjection } from './sessionProjectionModel';

/** Session load and branch switch write conversation and trace through this function. */
export function hydrateLoadedSessionSurface(input: {
  messages: ConversationMessage[];
  branchState?: ConversationBranchState | null;
  planReview?: PlanReviewProjection | null;
  tracePresentation?: AgentRunPresentation | null;
  applyTrace?: boolean;
}): void {
  if (input.planReview) usePlanReviewStore.getState().accept(input.planReview);
  useConversationStore.getState().setConversationSnapshot(input.messages, input.branchState);
  if (input.applyTrace) useWorkflowStore.getState().setTracePresentation(input.tracePresentation ?? null);
}

export function hydrateSessionProjection(projection: SessionProjection): boolean {
  useConversationStore.setState({
    timeline: projection.timeline,
    reasoningSummaries: projection.reasoningSummaries,
    monotonicStoppedTurnIds: projection.monotonicStoppedTurnIds,
    monotonicStoppedRequestIds: projection.monotonicStoppedRequestIds,
    revokedRequestIds: projection.revokedRequestIds,
  });
  useConversationStore.getState().setConversationSnapshot(
    projection.allMessages,
    projection.branchState,
  );
  useWorkflowStore.getState().setWorkflowState(projection.workflowState);
  useWorkflowStore.getState().setTracePresentation(projection.tracePresentation);
  const capture = useCaptureStore.getState();
  capture.setContextSnapshot(projection.contextSnapshot);
  capture.setOpenedCapture(projection.openedCapture);
  capture.setCaptures(projection.contextSnapshot?.captureDescriptors ?? []);
  useSessionStore.getState().hydrateContextUsage(projection.contextUsage);
  return true;
}