import { useEffect } from 'react';
import { RevisionLanes } from '../../lib/revisionLanes';
import { mapActionEventToTimelineEntry } from '../../services/conversationTimeline';
import { hydrateLoadedSessionSurface } from '../../stores/sessionProjectionHydration';
import { useConversationStore } from '../../stores/conversationStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import type { ActionEvent } from '@shared/types/evidence';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type { WorkflowState } from '@shared/types/workflow';

/**
 * The surface load and the usage read are revision lanes of the one app-level bootstrap: a read for a session that is
 * no longer current changes nothing.
 */
const reads = new RevisionLanes();

/** The session's action chain is the timeline; messages and their Working trace come from main as they are. */
function applyEvidence(events: ActionEvent[]): void {
  useConversationStore
    .getState()
    .setTimeline(
      events
        .map((event) => mapActionEventToTimelineEntry(event))
        .filter((entry): entry is AgentTimelineEntry => entry !== null),
    );
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
    if (!sessionId) {
      useConversationStore.getState().setConversationSnapshot([], null);
      useConversationStore.getState().setTimeline([]);
      useWorkflowStore.getState().setTracePresentation(null);
      return;
    }
    if (!shellReady) return;

    const read = reads.begin('surface');
    const live = () => reads.isLatest('surface', read) && useProjectStore.getState().currentSessionId === sessionId;
    void electronAPI.workflow
      .getState()
      .then((state) => {
        if (!live()) return;
        const workflow = state as WorkflowState | null;
        useWorkflowStore.getState().setWorkflowState(workflow);
        useConversationStore.getState().setReasoningSummaries(workflow?.reasoningSummaries ?? []);
      })
      .catch(() => undefined);
    const evidence = electronAPI.evidence
      .getChain()
      .then((result) => result.events as ActionEvent[])
      .catch(() => [] as ActionEvent[]);

    const conversation = useConversationStore.getState();
    if (conversation.surfaceSessionId === sessionId || conversation.historyLoadingSessionId === sessionId) {
      void evidence.then((events) => {
        if (live()) applyEvidence(events);
      });
    } else {
      conversation.setHistoryLoadingSessionId(sessionId);
      void (async () => {
        const [historyResult, events, traceResult] = await Promise.all([
          electronAPI.conversation
            .getHistory(sessionId)
            .catch(() => ({ messages: [], branchState: null, planReview: null })),
          evidence,
          electronAPI.trace.getProjection(sessionId).catch(() => ({ success: false, presentation: null })),
        ]);
        if (!reads.isLatest('surface', read)) return;
        useConversationStore.getState().setHistoryLoadingSessionId(null);
        applyEvidence(events);
        hydrateLoadedSessionSurface({
          sessionId,
          messages: historyResult.messages,
          branchState: historyResult.branchState ?? null,
          planReview: historyResult.planReview ?? null,
          tracePresentation: traceResult.presentation ?? null,
          applyTrace: true,
        });
      })();
    }
    return () => {
      reads.forget('surface');
      // A switch may already have marked the next session as being opened; only this load's own mark is cleared.
      if (useConversationStore.getState().historyLoadingSessionId === sessionId) {
        useConversationStore.getState().setHistoryLoadingSessionId(null);
      }
    };
  }, [sessionId, shellReady]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!sessionId) {
      clearUsageSnapshot();
      return undefined;
    }
    const read = reads.begin('usage');
    void electronAPI.workflow
      .getRunUsage({
        sessionId,
        ...(currentRunId ? { runId: currentRunId } : {}),
      })
      .then((result) => {
        if (!reads.isLatest('usage', read) || useProjectStore.getState().currentSessionId !== sessionId) return;
        useSessionStore.getState().setCurrentRunUsage(result.usage, result.stale);
      })
      .catch(() => undefined);
    return () => {
      reads.forget('usage');
    };
  }, [clearUsageSnapshot, currentRunId, sessionId]);
}
