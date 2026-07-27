import { useCaptureStore } from './captureStore';
import { useConversationStore } from './conversationStore';
import { useWorkflowStore } from './workflowStore';
import type { SessionProjection } from './sessionProjectionModel';

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
  return true;
}