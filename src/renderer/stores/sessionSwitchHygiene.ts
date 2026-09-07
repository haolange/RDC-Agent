import { useCaptureStore } from './captureStore';
import { useComposerSessionContextStore } from './composerSessionContextStore';
import { useConversationStore } from './conversationStore';
import { useSessionProjectionStore } from './sessionProjectionStore';
import { useSessionStore } from './sessionStore';
import { useWorkflowStore } from './workflowStore';

export function applySessionSwitchHygiene(options: {
  previousSessionId?: string | null;
  nextSessionId?: string | null;
}): void {
  const { previousSessionId, nextSessionId } = options;
  const projection = useSessionProjectionStore.getState();

  if (previousSessionId && previousSessionId !== nextSessionId) {
    projection.captureActiveSession(previousSessionId);
  }

  useConversationStore.setState({
    monotonicStoppedTurnIds: [],
    monotonicStoppedRequestIds: [],
    revokedRequestIds: [],
  });
  useConversationStore.getState().setConversationSnapshot([], null);
  useConversationStore.getState().setTimeline([]);
  useConversationStore.getState().setReasoningSummaries([]);
  useWorkflowStore.getState().setTracePresentation(null);
  useWorkflowStore.getState().setWorkflowState(null);
  useCaptureStore.getState().reset();
  useSessionStore.getState().clearUsageSnapshot();
  useSessionStore.getState().setPreparedTurnContext(null);
  useSessionStore.getState().setConversationPreparationPhase('idle');
  useComposerSessionContextStore.getState().resetForSessionSwitch();

  if (nextSessionId) {
    projection.activateSession(nextSessionId);
  }
}
