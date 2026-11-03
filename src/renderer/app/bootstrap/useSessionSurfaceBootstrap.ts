import { useEffect } from 'react';
import type { ActionEvent } from '@shared/types/evidence';
import { hydrateMessagesWithActionEvents } from '../../services/conversationTimeline';
import { hydrateLoadedSessionSurface } from '../../stores/sessionProjectionHydration';
import { useConversationStore } from '../../stores/conversationStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useWorkflowStore } from '../../stores/workflowStore';

export function useSessionSurfaceBootstrap(shellReady: boolean): void {
  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
  const currentRun = useSessionStore((state) => state.currentRun);
  const setConversationSnapshot = useConversationStore((state) => state.setConversationSnapshot);
  const setTracePresentation = useWorkflowStore((state) => state.setTracePresentation);
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

    let cancelled = false;
    void (async () => {
      const conversation = useConversationStore.getState();
      const historyAlreadyBound = conversation.allConversationMessages.some(
        (message) => message.sessionId === currentSession.sessionId,
      );
      const traceAlreadyBound = useWorkflowStore.getState().tracePresentation?.sessionId === currentSession.sessionId;
      const [historyResult, evidenceResult, traceResult] = await Promise.all([
        historyAlreadyBound
          ? Promise.resolve(null)
          : electronAPI.conversation.getHistory(currentSession.sessionId).catch(() => ({ messages: [], branchState: null })),
        historyAlreadyBound
          ? Promise.resolve({ events: [] as ActionEvent[] })
          : electronAPI.evidence.getChain().catch(() => ({ events: [] as ActionEvent[] })),
        traceAlreadyBound
          ? Promise.resolve(null)
          : electronAPI.trace.getProjection(currentSession.sessionId).catch(() => ({ success: false, presentation: null })),
      ]);
      if (cancelled) return;
      if (historyResult) {
        hydrateLoadedSessionSurface({
          messages: hydrateMessagesWithActionEvents(
            historyResult.messages ?? [],
            (evidenceResult.events ?? []) as ActionEvent[],
          ),
          branchState: historyResult.branchState ?? null,
          planReview: 'planReview' in historyResult ? historyResult.planReview ?? null : null,
          tracePresentation: traceResult ? traceResult.presentation ?? null : undefined,
          applyTrace: Boolean(traceResult),
        });
      } else if (traceResult) {
        setTracePresentation(traceResult.presentation ?? null);
      }
    })();
    return () => { cancelled = true; };
  }, [currentSession?.sessionId, shellReady, setConversationSnapshot, setTracePresentation]);

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
