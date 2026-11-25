import { useEffect } from 'react';
import { hydrateMessagesWithActionEvents, mapActionEventToTimelineEntry } from '../../services/conversationTimeline';
import { hydrateLoadedSessionSurface } from '../../stores/sessionProjectionHydration';
import { useConversationStore } from '../../stores/conversationStore';
import { useEvidenceStore } from '../../stores/evidenceStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { ActionEvent } from '@shared/types/evidence';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type { ConversationMessage } from '@shared/types/conversation';
import type { WorkflowState } from '@shared/types/workflow';

function applyEvidence(events: ActionEvent[], messagesFrom: () => ConversationMessage[]): ConversationMessage[] {
  useEvidenceStore.getState().setActionEvents(events);
  useConversationStore.getState().setTimeline(events
    .map((event) => mapActionEventToTimelineEntry(event))
    .filter((entry): entry is AgentTimelineEntry => entry !== null));
  return hydrateMessagesWithActionEvents(messagesFrom(), events);
}

/**
 * Loads what the current session's surfaces show, once per session id. A session that becomes current through the
 * session opener already carries history and trace, so only its evidence and workflow state load here; one that
 * became current another way loads history and trace too. A change of the session's record (Agent, model, title) is
 * not a reason to load again.
 */
export function useSessionSurfaceBootstrap(shellReady: boolean): void {
  const currentProjectId = useProjectStore((state) => state.currentProject?.projectId ?? null);
  const sessionId = useProjectStore((state) => state.currentSessionId);
  const currentRunId = useSessionStore((state) => state.currentRun?.runId ?? null);
  const clearUsageSnapshot = useSessionStore((state) => state.clearUsageSnapshot);
  const setActiveTerminalContext = useTerminalStore((state) => state.setActiveContext);
  const refreshTerminalEntries = useTerminalStore((state) => state.refreshEntries);

  useEffect(() => {
    setActiveTerminalContext({ sessionId, projectId: currentProjectId, runId: currentRunId });
    void refreshTerminalEntries();
  }, [currentProjectId, currentRunId, sessionId, refreshTerminalEntries, setActiveTerminalContext]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;
    if (!sessionId) {
      useConversationStore.getState().setConversationSnapshot([], null);
      useConversationStore.getState().setTimeline([]);
      useWorkflowStore.getState().setTracePresentation(null);
      return;
    }
    if (!shellReady) return;

    let cancelled = false;
    const live = () => !cancelled && useProjectStore.getState().currentSessionId === sessionId;
    void electronAPI.workflow.getState().then((state) => {
      if (!live()) return;
      const workflow = state as WorkflowState | null;
      useWorkflowStore.getState().setWorkflowState(workflow);
      useConversationStore.getState().setReasoningSummaries(workflow?.reasoningSummaries ?? []);
    }).catch(() => undefined);
    const evidence = electronAPI.evidence.getChain()
      .then((result) => (result.events ?? []) as ActionEvent[])
      .catch(() => [] as ActionEvent[]);

    const conversation = useConversationStore.getState();
    if (conversation.surfaceSessionId === sessionId || conversation.historyLoadingSessionId === sessionId) {
      void evidence.then((events) => {
        if (!live()) return;
        useConversationStore.getState().setConversationMessages(
          applyEvidence(events, () => useConversationStore.getState().allConversationMessages),
        );
      });
    } else {
      conversation.setHistoryLoadingSessionId(sessionId);
      void (async () => {
        const [historyResult, events, traceResult] = await Promise.all([
          electronAPI.conversation.getHistory(sessionId).catch(() => ({ messages: [], branchState: null, planReview: null })),
          evidence,
          electronAPI.trace.getProjection(sessionId).catch(() => ({ success: false, presentation: null })),
        ]);
        if (cancelled) return;
        useConversationStore.getState().setHistoryLoadingSessionId(null);
        hydrateLoadedSessionSurface({
          sessionId,
          messages: applyEvidence(events, () => historyResult.messages ?? []),
          branchState: historyResult.branchState ?? null,
          planReview: historyResult.planReview ?? null,
          tracePresentation: traceResult.presentation ?? null,
          applyTrace: true,
        });
      })();
    }
    return () => {
      cancelled = true;
      // A switch may already have marked the next session as being opened; only this load's own mark is cleared.
      if (useConversationStore.getState().historyLoadingSessionId === sessionId) {
        useConversationStore.getState().setHistoryLoadingSessionId(null);
      }
    };
  }, [sessionId, shellReady]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI || !sessionId) {
      clearUsageSnapshot();
      return undefined;
    }
    let cancelled = false;
    void electronAPI.workflow.getRunUsage({
      sessionId,
      ...(currentRunId ? { runId: currentRunId } : {}),
    }).then((result) => {
      if (cancelled || useProjectStore.getState().currentSessionId !== sessionId) return;
      useSessionStore.getState().setCurrentRunUsage(result.usage, result.stale);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [clearUsageSnapshot, currentRunId, sessionId]);
}
