import { useEffect } from 'react';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type { ActionEvent } from '@shared/types/evidence';
import type { ResolvedTheme } from '@shared/types/settings';
import type { WorkflowState } from '@shared/types/workflow';
import {
  hydrateMessagesWithActionEvents,
  mapActionEventToTimelineEntry,
} from '../../services/conversationTimeline';
import { applyChromeTheme } from '../theme/applyChromeTheme';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useConversationStore } from '../../stores/conversationStore';
import { useEvidenceStore } from '../../stores/evidenceStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useProjectStore } from '../../stores/projectStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useWorkflowStore } from '../../stores/workflowStore';

export function useAppBootstrap(options: {
  setIsLoading: (loading: boolean) => void;
  setConnectionStatus: (status: 'connected' | 'degraded' | 'offline') => void;
  runtimeTestMode: boolean | null;
  setRuntimeTestMode: (mode: boolean | null) => void;
  setWindowMaximized: (maximized: boolean) => void;
  resolvedTheme: ResolvedTheme;
}): void {
  const {
    setIsLoading,
    setConnectionStatus,
    runtimeTestMode,
    setRuntimeTestMode,
    setWindowMaximized,
    resolvedTheme,
  } = options;

  const settings = useAppSettingsStore((state) => state.settings);
  const hydrateSettings = useAppSettingsStore((state) => state.hydrate);
  const hydrateLayout = useLayoutStore((state) => state.hydrateFromSettings);

  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
  const currentRun = useSessionStore((state) => state.currentRun);

  const setConversationSnapshot = useConversationStore((state) => state.setConversationSnapshot);
  const setTracePresentation = useWorkflowStore((state) => state.setTracePresentation);
  const clearUsageSnapshot = useSessionStore((state) => state.clearUsageSnapshot);
  const setActiveTerminalContext = useTerminalStore((state) => state.setActiveContext);
  const refreshTerminalEntries = useTerminalStore((state) => state.refreshEntries);

  useEffect(() => {
    document.documentElement.lang = settings.appearance.language;
    applyChromeTheme(settings.appearance, resolvedTheme);
  }, [resolvedTheme, settings.appearance]);

  useEffect(() => {
    const initApp = async () => {
      try {
        const electronAPI = window.electronAPI;
        if (!electronAPI) {
          setConnectionStatus('offline');
          return;
        }

        const [appSettings, appMeta, isMaximized] = await Promise.all([
          electronAPI.settings.get(),
          electronAPI.appMeta.get(),
          electronAPI.windowControls.isMaximized(),
        ]);

        hydrateSettings(appSettings, appMeta.systemTheme);
        hydrateLayout(appSettings);
        setRuntimeTestMode(appMeta.testMode);
        setWindowMaximized(isMaximized);
        setConnectionStatus('connected');
      } catch (error) {
        console.error('Failed to initialize app shell:', error);
        setConnectionStatus('degraded');
      } finally {
        window.setTimeout(() => setIsLoading(false), 320);
      }
    };

    void initApp();
  }, [hydrateLayout, hydrateSettings, setConnectionStatus, setIsLoading, setRuntimeTestMode, setWindowMaximized]);

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
    if (!electronAPI) {
      return;
    }

    if (!currentSession?.sessionId) {
      setConversationSnapshot([], null);
      return;
    }

    if (runtimeTestMode === null) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const [historyResult, evidenceResult, traceResult] = await Promise.all([
        electronAPI.conversation.getHistory(currentSession.sessionId).catch(() => ({ messages: [], branchState: null })),
        electronAPI.evidence.getChain().catch(() => ({ events: [] as ActionEvent[] })),
        electronAPI.trace.getProjection(currentSession.sessionId).catch(() => ({ success: false, presentation: null })),
      ]);
      if (cancelled) return;
      setConversationSnapshot(
        hydrateMessagesWithActionEvents(
          historyResult.messages ?? [],
          (evidenceResult.events ?? []) as ActionEvent[],
        ),
        historyResult.branchState ?? null,
      );
      setTracePresentation(traceResult.presentation ?? null);
    })();
    return () => { cancelled = true; };
  }, [currentSession?.sessionId, runtimeTestMode, setConversationSnapshot, setTracePresentation]);

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

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI?.events?.onEffectiveCatalogChanged) return undefined;
    // Agents modelOptions are projected only on settings:get; keep them fresh after discovery.
    let debounceTimer: number | undefined;
    const unsubscribe = electronAPI.events.onEffectiveCatalogChanged(() => {
      if (debounceTimer !== undefined) {
        window.clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(() => {
        debounceTimer = undefined;
        void useAppSettingsStore.getState().reloadSettings().catch(() => undefined);
      }, 250);
    });
    return () => {
      if (debounceTimer !== undefined) {
        window.clearTimeout(debounceTimer);
      }
      unsubscribe?.();
    };
  }, []);

  useProjectInputsBootstrap(runtimeTestMode);
  useSessionRestoreBootstrap(runtimeTestMode);
}

function useProjectInputsBootstrap(runtimeTestMode: boolean | null): void {
  const currentProject = useProjectStore((state) => state.currentProject);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!currentProject) {
      useProjectStore.getState().setProjectInputs([]);
      return;
    }

    if (runtimeTestMode === null) {
      return;
    }

    if (navigator.webdriver && runtimeTestMode) {
      const seededInputs = currentProject.inputs?.length
        ? currentProject.inputs
        : useProjectStore.getState().projectInputs;
      useProjectStore.getState().updateProjectInputs(currentProject.projectId, seededInputs);
      return;
    }

    if (!electronAPI) {
      useProjectStore.getState().updateProjectInputs(currentProject.projectId, currentProject.inputs ?? []);
      return;
    }

    void electronAPI.project.inputs.list(currentProject.projectId)
      .then((result) => {
        useProjectStore.getState().updateProjectInputs(currentProject.projectId, result.inputs ?? []);
      })
      .catch(() => {
        useProjectStore.getState().updateProjectInputs(currentProject.projectId, currentProject.inputs ?? []);
      });
  }, [currentProject, runtimeTestMode]);
}

function useSessionRestoreBootstrap(runtimeTestMode: boolean | null): void {
  const currentSession = useProjectStore((state) => state.currentSession);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (runtimeTestMode === null) {
      return;
    }

    if (navigator.webdriver && runtimeTestMode) {
      return;
    }

    if (!electronAPI || !currentSession) {
      useConversationStore.getState().setTimeline([]);
      useWorkflowStore.getState().setTracePresentation(null);
      return;
    }

    void electronAPI.evidence.getChain()
      .then((result) => {
        useEvidenceStore.getState().setActionEvents(result.events ?? []);
        const timeline = (result.events ?? [])
          .map((event) => mapActionEventToTimelineEntry(event as ActionEvent))
          .filter((entry): entry is AgentTimelineEntry => entry !== null);
        useConversationStore.getState().setTimeline(timeline);
        useConversationStore.getState().setConversationMessages(
          hydrateMessagesWithActionEvents(
            useConversationStore.getState().allConversationMessages,
            (result.events ?? []) as ActionEvent[],
          ),
        );
      })
      .catch(() => {
        useEvidenceStore.getState().setActionEvents([]);
        useConversationStore.getState().setTimeline([]);
      });

    void electronAPI.workflow.getState()
      .then((state) => {
        if (!state) {
          useWorkflowStore.getState().setWorkflowState(null);
          useConversationStore.getState().setReasoningSummaries([]);
          return;
        }
        const workflow = state as WorkflowState;
        useWorkflowStore.getState().setWorkflowState(workflow);
        useConversationStore.getState().setReasoningSummaries(workflow.reasoningSummaries ?? []);
      })
      .catch(() => undefined);

    void electronAPI.trace.getProjection(currentSession.sessionId)
      .then((result) => {
        useWorkflowStore.getState().setTracePresentation(result.presentation ?? null);
      })
      .catch(() => {
        useWorkflowStore.getState().setTracePresentation(null);
      });
  }, [currentSession, runtimeTestMode]);
}
