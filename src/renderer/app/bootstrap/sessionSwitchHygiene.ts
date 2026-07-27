import { useConversationStore } from '../../stores/conversationStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useComposerSessionContextStore } from '../../features/debugger/composer/composerSessionContext';
import { useSessionProjectionStore } from '../../stores/sessionProjectionStore';
import { useCaptureStore } from '../../stores/captureStore';

/**
 * Immediate UI hygiene when leaving or entering a session.
 * Captures the previous active session into the projection cache, clears active
 * stores, resets composer in-flight state, then optionally hydrates the next session.
 */
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
