import { useEffect } from 'react';
import { hydrateMessagesWithActionEvents } from '../../services/conversationTimeline';
import { hydrateLoadedSessionSurface } from '../../stores/sessionProjectionHydration';
import { useConversationStore } from '../../stores/conversationStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useTerminalStore } from '../../stores/terminalStore';
import type { ActionEvent } from '@shared/types/evidence';

export function useSessionSurfaceBootstrap(shellReady: boolean): void {
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
  const currentRun = useSessionStore((state) => state.currentRun);
  const setConversationSnapshot = useConversationStore((state) => state.setConversationSnapshot);
  const clearUsageSnapshot = useSessionStore((state) => state.clearUsageSnapshot);
  const setActiveTerminalContext = useTerminalStore((state) => state.setActiveContext);
  const refreshTerminalEntries = useTerminalStore((state) => state.refreshEntries);

  useEffect(() => {
    setActiveTerminalContext({
      sessionId: currentSession?.sessionId ?? null,
      projectId: currentProject?.projectId ?? null,
      runId: currentRun?.runId ?? null,
    });
    void refreshTerminalEntries();
  }, [
    currentProject?.projectId,
    currentRun?.runId,
    currentSession?.sessionId,
    refreshTerminalEntries,
    setActiveTerminalContext,
  ]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;
    if (!currentSession?.sessionId) {
      setConversationSnapshot([], null);
      return;
    }
    if (!shellReady) return;

    const sessionId = currentSession.sessionId;
    const conversation = useConversationStore.getState();
    // The session opener loads history and trace in one request; only a session that became current another way
    // (or whose surface was cleared since) loads here.
    if (conversation.surfaceSessionId === sessionId || conversation.historyLoadingSessionId === sessionId) return;

    let cancelled = false;
    void (async () => {
      conversation.setHistoryLoadingSessionId(sessionId);
      const [historyResult, evidenceResult, traceResult] = await Promise.all([
        electronAPI.conversation.getHistory(sessionId).catch(() => ({ messages: [], branchState: null, planReview: null })),
        electronAPI.evidence.getChain().catch(() => ({ events: [] as ActionEvent[] })),
        electronAPI.trace.getProjection(sessionId).catch(() => ({ success: false, presentation: null })),
      ]);
      if (cancelled) return;
      useConversationStore.getState().setHistoryLoadingSessionId(null);
      hydrateLoadedSessionSurface({
        sessionId,
        messages: hydrateMessagesWithActionEvents(historyResult.messages ?? [], (evidenceResult.events ?? []) as ActionEvent[]),
        branchState: historyResult.branchState ?? null,
        planReview: historyResult.planReview ?? null,
        tracePresentation: traceResult.presentation ?? null,
        applyTrace: true,
      });
    })();
    return () => {
      cancelled = true;
      // A switch may already have marked the next session as being opened; only this load's own mark is cleared.
      if (useConversationStore.getState().historyLoadingSessionId === sessionId) {
        useConversationStore.getState().setHistoryLoadingSessionId(null);
      }
    };
  }, [currentSession?.sessionId, shellReady, setConversationSnapshot]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI || !currentSession?.sessionId) {
      clearUsageSnapshot();
      return undefined;
    }
    const sessionId = currentSession.sessionId;
    const runId = currentRun?.runId;
    let cancelled = false;
    void electronAPI.workflow.getRunUsage({
      sessionId,
      ...(runId ? { runId } : {}),
    }).then((result) => {
      if (cancelled || useProjectStore.getState().currentSession?.sessionId !== sessionId) return;
      useSessionStore.getState().setCurrentRunUsage(result.usage, result.stale);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [clearUsageSnapshot, currentRun?.runId, currentSession?.sessionId]);
}
