import { useEffect } from 'react';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type { ActionEvent } from '@shared/types/evidence';
import type { ResolvedTheme } from '@shared/types/settings';
import type { WorkflowState } from '@shared/types/workflow';
import {
  hydrateMessagesWithActionEvents,
  mapActionEventToTimelineEntry,
} from '../../services/conversationTimeline';
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
  hasActiveDebugRun: boolean;
}): void {
  const {
    setIsLoading,
    setConnectionStatus,
    runtimeTestMode,
    setRuntimeTestMode,
    setWindowMaximized,
    resolvedTheme,
    hasActiveDebugRun,
  } = options;

  const settings = useAppSettingsStore((state) => state.settings);
  const hydrateSettings = useAppSettingsStore((state) => state.hydrate);
  const hydrateLayout = useLayoutStore((state) => state.hydrateFromSettings);

  const currentProject = useProjectStore((state) => state.currentProject);
  const currentSession = useProjectStore((state) => state.currentSession);
  const currentRun = useSessionStore((state) => state.currentRun);
  const currentRunUsage = useSessionStore((state) => state.currentRunUsage);

  const setConversationMessages = useConversationStore((state) => state.setConversationMessages);
  const setTracePresentation = useWorkflowStore((state) => state.setTracePresentation);
  const setCurrentRunUsage = useSessionStore((state) => state.setCurrentRunUsage);
  const setActiveTerminalContext = useTerminalStore((state) => state.setActiveContext);

  useEffect(() => {
    document.documentElement.lang = settings.appearance.language;
    document.documentElement.dataset.theme = settings.appearance.theme;
    document.documentElement.dataset.resolvedTheme = resolvedTheme;
    document.documentElement.dataset.fontScale = settings.appearance.fontScale;
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
  }, [currentProject?.projectId, currentRun?.runId, currentSession?.sessionId, setActiveTerminalContext]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      return;
    }

    if (!currentSession?.sessionId) {
      setConversationMessages([]);
      return;
    }

    if (navigator.webdriver && runtimeTestMode) {
      return;
    }

    void (async () => {
      const [historyResult, evidenceResult, workstreamResult] = await Promise.all([
        electronAPI.conversation.getHistory(currentSession.sessionId).catch(() => ({ messages: [] })),
        electronAPI.evidence.getChain().catch(() => ({ events: [] as ActionEvent[] })),
        electronAPI.workflow.getWorkstreamSession(currentSession.sessionId).catch(() => ({ success: false, presentation: null })),
      ]);
      setConversationMessages(hydrateMessagesWithActionEvents(
        historyResult.messages ?? [],
        (evidenceResult.events ?? []) as ActionEvent[],
      ));
      setTracePresentation(workstreamResult.presentation ?? null);
    })();
  }, [currentSession?.sessionId, runtimeTestMode, setConversationMessages, setTracePresentation]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI || !currentRun?.runId || !hasActiveDebugRun) {
      setCurrentRunUsage(null);
      return;
    }

    if (navigator.webdriver && currentRunUsage?.runId === currentRun.runId) {
      return;
    }

    let cancelled = false;
    void electronAPI.workflow.getRunUsage(currentRun.runId)
      .then((result) => {
        if (!cancelled) {
          setCurrentRunUsage(result.usage ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCurrentRunUsage(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentRun?.runId, currentRunUsage?.runId, hasActiveDebugRun, setCurrentRunUsage]);

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
            useConversationStore.getState().conversationMessages,
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
          useWorkflowStore.getState().setCurrentDebugPlan(null);
          useWorkflowStore.getState().setPendingQuestions(null);
          useConversationStore.getState().setReasoningSummaries([]);
          return;
        }
        const workflow = state as WorkflowState;
        useWorkflowStore.getState().setWorkflowState(workflow);
        useWorkflowStore.getState().setCurrentDebugPlan(workflow.debugPlan ?? null);
        useWorkflowStore.getState().setPendingQuestions(workflow.pendingQuestions ?? null);
        useConversationStore.getState().setReasoningSummaries(workflow.reasoningSummaries ?? []);
      })
      .catch(() => undefined);

    void electronAPI.workflow.getWorkstreamSession(currentSession.sessionId)
      .then((result) => {
        useWorkflowStore.getState().setTracePresentation(result.presentation ?? null);
      })
      .catch(() => {
        useWorkflowStore.getState().setTracePresentation(null);
      });
  }, [currentSession?.sessionId, runtimeTestMode]);
}
