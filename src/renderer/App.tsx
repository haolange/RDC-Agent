import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DebuggerPage } from './pages/Debugger';
import { ControlPanel } from './components/ControlPanel';
import { DeviceSelector } from './components/DeviceSelector';
import { Sidebar } from './components/Sidebar';
import { UserMenu } from './components/UserMenu';
import { SettingsModal } from './components/SettingsModal';
import { TerminalDrawer } from './components/TerminalDrawer';
import { useLayoutStore } from './stores/layoutStore';
import { useSessionStore } from './stores/sessionStore';
import { useDeviceStore } from './stores/deviceStore';
import { useAppSettingsStore } from './stores/appSettingsStore';
import { useTerminalStore } from './stores/terminalStore';
import { useI18n } from './i18n';
import type { AgentRole, AgentTimelineEntry } from '@shared/types/agent';
import type { ToolTraceEntry } from '@shared/types/tool';
import type { ReplayDeviceStatusChangedPayload } from '@shared/types/device';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import type { ResolvedTheme } from '@shared/types/settings';
import type { ActionEvent } from '@shared/types/evidence';
import type { AgentMode } from '@shared/types/layout';
import type {
  CaptureDescriptor,
  ContextSnapshot,
  DebugSessionStartRequest,
  OpenedCaptureState,
  ProjectInputRecord,
  ProjectRecord,
  RunSummary,
  SessionRecord,
} from '@shared/types/session';
import type { WorkflowStage, WorkflowState } from '@shared/types/workflow';
import { AGENT_MODES } from '@shared/constants/agents';
import {
  APP_MIN_MAIN_WIDTH,
  APP_RESIZE_HANDLE_WIDTH,
  LEFT_SIDEBAR_COLLAPSED_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  RIGHT_PANEL_COLLAPSED_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
} from '@shared/constants/layout';

type DragSide = 'left' | 'right';

interface WorkbenchSeedState {
  projects: ProjectRecord[];
  sessions: SessionRecord[];
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  currentRun: RunSummary | null;
  contextSnapshot: ContextSnapshot | null;
  captures: CaptureDescriptor[];
  projectInputs: ProjectInputRecord[];
  openedCapture: OpenedCaptureState | null;
  timeline: AgentTimelineEntry[];
  actionEvents?: ActionEvent[];
  workflowState?: WorkflowState | null;
  runs?: RunSummary[];
}

type E2EWindow = Window & {
  __RDC_AGENT_E2E__?: {
    seedWorkbenchState: (state: WorkbenchSeedState) => void;
    resetWorkbenchState: () => void;
    getWorkbenchState: () => WorkbenchSeedState;
  };
};

const reduceOverflow = (
  desired: number,
  minimum: number,
  overflow: number,
): { width: number; remainingOverflow: number } => {
  const reducible = Math.max(0, desired - minimum);
  const reduction = Math.min(reducible, overflow);
  return {
    width: desired - reduction,
    remainingOverflow: overflow - reduction,
  };
};

const getResponsiveMinMainWidth = (containerWidth: number): number => {
  if (containerWidth <= 420) {
    return 240;
  }
  if (containerWidth <= 720) {
    return 280;
  }
  if (containerWidth <= 960) {
    return 360;
  }
  return APP_MIN_MAIN_WIDTH;
};

const canFitLayout = (
  containerWidth: number,
  leftWidth: number,
  rightWidth: number,
  leftCollapsed: boolean,
  rightCollapsed: boolean,
  minMainWidth: number,
): boolean => {
  const desiredLeft = leftCollapsed ? LEFT_SIDEBAR_COLLAPSED_WIDTH : leftWidth;
  const desiredRight = rightCollapsed ? RIGHT_PANEL_COLLAPSED_WIDTH : rightWidth;
  const availableSidebarSpace = Math.max(0, containerWidth - minMainWidth - APP_RESIZE_HANDLE_WIDTH * 2);
  return desiredLeft + desiredRight <= availableSidebarSpace;
};

const resolveResponsiveSidebarState = (
  containerWidth: number,
  leftWidth: number,
  rightWidth: number,
  leftCollapsed: boolean,
  rightCollapsed: boolean,
): { leftCollapsed: boolean; rightCollapsed: boolean; minMainWidth: number } => {
  if (containerWidth <= 0) {
    return {
      leftCollapsed,
      rightCollapsed,
      minMainWidth: APP_MIN_MAIN_WIDTH,
    };
  }

  const minMainWidth = getResponsiveMinMainWidth(containerWidth);
  let nextLeftCollapsed = leftCollapsed;
  let nextRightCollapsed = rightCollapsed;

  if (!canFitLayout(containerWidth, leftWidth, rightWidth, nextLeftCollapsed, nextRightCollapsed, minMainWidth)) {
    nextRightCollapsed = true;
  }

  if (!canFitLayout(containerWidth, leftWidth, rightWidth, nextLeftCollapsed, nextRightCollapsed, minMainWidth)) {
    nextLeftCollapsed = true;
  }

  return {
    leftCollapsed: nextLeftCollapsed,
    rightCollapsed: nextRightCollapsed,
    minMainWidth,
  };
};

const resolveSidebarWidths = (
  containerWidth: number,
  leftWidth: number,
  rightWidth: number,
  leftCollapsed: boolean,
  rightCollapsed: boolean,
  minMainWidth: number,
): { left: number; right: number } => {
  if (containerWidth <= 0) {
    return {
      left: leftCollapsed ? LEFT_SIDEBAR_COLLAPSED_WIDTH : leftWidth,
      right: rightCollapsed ? RIGHT_PANEL_COLLAPSED_WIDTH : rightWidth,
    };
  }

  const desiredLeft = leftCollapsed ? LEFT_SIDEBAR_COLLAPSED_WIDTH : leftWidth;
  const desiredRight = rightCollapsed ? RIGHT_PANEL_COLLAPSED_WIDTH : rightWidth;
  const minLeft = leftCollapsed ? LEFT_SIDEBAR_COLLAPSED_WIDTH : LEFT_SIDEBAR_MIN_WIDTH;
  const minRight = rightCollapsed ? RIGHT_PANEL_COLLAPSED_WIDTH : RIGHT_PANEL_MIN_WIDTH;
  const availableSidebarSpace = Math.max(0, containerWidth - minMainWidth - APP_RESIZE_HANDLE_WIDTH * 2);
  const desiredTotal = desiredLeft + desiredRight;

  if (desiredTotal <= availableSidebarSpace) {
    return { left: desiredLeft, right: desiredRight };
  }

  let overflow = desiredTotal - availableSidebarSpace;
  const leftPass = reduceOverflow(desiredLeft, minLeft, overflow);
  overflow = leftPass.remainingOverflow;
  const rightPass = reduceOverflow(desiredRight, minRight, overflow);
  overflow = rightPass.remainingOverflow;

  if (overflow > 0) {
    const secondLeftPass = reduceOverflow(leftPass.width, minLeft, overflow);
    overflow = secondLeftPass.remainingOverflow;
    const secondRightPass = reduceOverflow(rightPass.width, minRight, overflow);
    return {
      left: Math.round(secondLeftPass.width),
      right: Math.round(secondRightPass.width),
    };
  }

  return {
    left: Math.round(leftPass.width),
    right: Math.round(rightPass.width),
  };
};

const mergeCapturesWithSnapshot = (
  currentCaptures: CaptureDescriptor[],
  snapshot: ContextSnapshot,
): CaptureDescriptor[] => {
  if (!snapshot.captureDescriptors?.length) {
    return currentCaptures;
  }

  const incomingById = new Map(snapshot.captureDescriptors.map((capture) => [capture.id, capture]));
  const merged = currentCaptures.map((capture) => {
    const incoming = incomingById.get(capture.id);
    return incoming ? { ...capture, ...incoming } : capture;
  });

  snapshot.captureDescriptors.forEach((capture) => {
    if (!merged.some((entry) => entry.id === capture.id)) {
      merged.push(capture);
    }
  });

  return merged;
};

const mapActionEventToTimelineEntry = (event: ActionEvent): AgentTimelineEntry | null => {
  switch (event.event_type) {
    case 'user_message':
      return {
        id: event.event_id,
        type: 'user',
        content: String(event.payload.content || ''),
        timestamp: event.ts_ms,
      };
    case 'agent_summary':
      return {
        id: event.event_id,
        type: 'reasoning',
        agentRole: event.agent_id as AgentTimelineEntry['agentRole'],
        title: String(event.payload.stage || 'Reasoning'),
        content: String(event.payload.summary || event.payload.content || ''),
        reasoningSummary: {
          summaryId: event.event_id,
          stage: (String(event.payload.stage || 'dispatch') as WorkflowStage),
          agentId: event.agent_id as AgentRole,
          summary: String(event.payload.summary || event.payload.content || ''),
          evidence: Array.isArray(event.payload.evidence) ? event.payload.evidence.map(String) : [],
          nextStep: String(event.payload.next_step || event.payload.nextStep || ''),
          confidence: typeof event.payload.confidence === 'number' ? event.payload.confidence : 0.5,
          createdAt: new Date(event.ts_ms).toISOString(),
        },
        actionEvent: event,
        timestamp: event.ts_ms,
      };
    case 'tool_execution':
      return {
        id: event.event_id,
        type: 'tool_call',
        status: event.status,
        content: String(event.payload.tool_name || event.payload.toolName || 'tool_execution'),
        actionEvent: event,
        timestamp: event.ts_ms,
      };
    case 'workflow_stage_transition':
      return {
        id: event.event_id,
        type: 'stage',
        title: String(event.payload.toStage || 'Stage'),
        content: `Stage: ${String(event.payload.fromStage || 'unknown')} -> ${String(event.payload.toStage || 'unknown')}`,
        actionEvent: event,
        timestamp: event.ts_ms,
      };
    case 'verification':
      return {
        id: event.event_id,
        type: 'verification',
        title: String(event.payload.verification_kind || 'verification'),
        status: event.status,
        content: String(event.payload.summary || event.payload.verdict || 'Verification updated'),
        actionEvent: event,
        timestamp: event.ts_ms,
      };
    case 'llm_call':
      return {
        id: event.event_id,
        type: 'system',
        title: `LLM ${String(event.payload.agentId || event.agent_id)}`,
        status: event.status,
        content: `${String(event.payload.providerId || 'provider')}/${String(event.payload.modelId || 'model')} - ${String(event.payload.summary || event.payload.requestId || 'llm_call')}`,
        actionEvent: event,
        timestamp: event.ts_ms,
      };
    case 'report_published':
      return {
        id: event.event_id,
        type: 'report',
        title: 'Report published',
        content: `Report published: ${String(event.payload.htmlPath || event.payload.markdownPath || 'reports ready')}`,
        actionEvent: event,
        timestamp: event.ts_ms,
      };
    case 'dispatch':
      return {
        id: event.event_id,
        type: 'dispatch',
        title: String(event.payload.targetAgent || event.payload.target_agent || 'specialist'),
        content: `Dispatch: ${String(event.payload.targetAgent || event.payload.target_agent || 'specialist')}`,
        actionEvent: event,
        timestamp: event.ts_ms,
      };
    case 'blocker':
      return {
        id: event.event_id,
        type: 'blocker',
        status: event.status,
        content: String(event.payload.reason || event.payload.message || 'Blocker detected'),
        actionEvent: event,
        timestamp: event.ts_ms,
      };
    case 'system':
      return {
        id: event.event_id,
        type: 'system',
        content: String(event.payload.message || ''),
        timestamp: event.ts_ms,
      };
    default:
      return null;
  }
};

const PlaceholderModePage: React.FC<{ mode: AgentMode }> = ({ mode }) => (
  <div className="debugger-page debugger-workspace" data-testid={`${mode}-placeholder-page`}>
    <div className="workspace-shell">
      <section className="debugger-idle-simple">
        <div className="debugger-idle-emoji" aria-hidden="true"> </div>
        <h1 className="debugger-idle-simple-title">{mode === 'analyzer' ? 'Analyzer' : 'Optimizer'}</h1>
      </section>
    </div>
  </div>
);

const App: React.FC = () => {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(true);
  const [, setConnectionStatus] = useState<'connected' | 'degraded' | 'offline'>('offline');
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [shellNotice, setShellNotice] = useState<string | null>(null);
  const [userMenuAnchor, setUserMenuAnchor] = useState<DOMRect | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [appBodyWidth, setAppBodyWidth] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const [promptValue, setPromptValue] = useState('');
  const [isPromptSending, setIsPromptSending] = useState(false);

  const appBodyRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ side: DragSide; startX: number; startWidth: number } | null>(null);

  const currentProject = useSessionStore((state) => state.currentProject);
  const currentSession = useSessionStore((state) => state.currentSession);
  const currentRun = useSessionStore((state) => state.currentRun);
  const captures = useSessionStore((state) => state.captures);
  const workflowState = useSessionStore((state) => state.workflowState);
  const currentMode = useLayoutStore((state) => state.currentMode);
  const leftSidebarCollapsed = useLayoutStore((state) => state.leftSidebarCollapsed);
  const rightPanelCollapsed = useLayoutStore((state) => state.rightPanelCollapsed);
  const leftSidebarWidth = useLayoutStore((state) => state.leftSidebarWidth);
  const rightPanelWidth = useLayoutStore((state) => state.rightPanelWidth);
  const setCurrentMode = useLayoutStore((state) => state.setCurrentMode);
  const setLeftSidebarWidth = useLayoutStore((state) => state.setLeftSidebarWidth);
  const setRightPanelWidth = useLayoutStore((state) => state.setRightPanelWidth);
  const toggleLeftSidebar = useLayoutStore((state) => state.toggleLeftSidebar);
  const toggleRightPanel = useLayoutStore((state) => state.toggleRightPanel);
  const persistLayout = useLayoutStore((state) => state.persistLayout);
  const hydrateLayout = useLayoutStore((state) => state.hydrateFromSettings);

  const settings = useAppSettingsStore((state) => state.settings);
  const systemTheme = useAppSettingsStore((state) => state.systemTheme);
  const hydrateSettings = useAppSettingsStore((state) => state.hydrate);
  const setSystemTheme = useAppSettingsStore((state) => state.setSystemTheme);
  const setTheme = useAppSettingsStore((state) => state.setTheme);
  const setLanguage = useAppSettingsStore((state) => state.setLanguage);
  const setFontScale = useAppSettingsStore((state) => state.setFontScale);

  const resolvedTheme: ResolvedTheme = settings.appearance.theme === 'system'
    ? systemTheme
    : settings.appearance.theme;
  const nickname = settings.profile.nickname || t('sidebar.userName');
  const showWorkbenchShell = currentMode === 'debugger';
  const isTerminalOpen = useTerminalStore((state) => state.isOpen);
  const toggleTerminalOpen = useTerminalStore((state) => state.toggleOpen);

  const showNotice = useCallback((message: string) => {
    setShellNotice(message);
  }, []);

  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setSessions = useSessionStore((state) => state.setSessions);
  const setCurrentSession = useSessionStore((state) => state.setCurrentSession);
  const setRuns = useSessionStore((state) => state.setRuns);
  const setContextSnapshot = useSessionStore((state) => state.setContextSnapshot);
  const setCaptures = useSessionStore((state) => state.setCaptures);
  const addActionEvent = useSessionStore((state) => state.addActionEvent);
  const setWorkflowState = useSessionStore((state) => state.setWorkflowState);
  const setCurrentDebugPlan = useSessionStore((state) => state.setCurrentDebugPlan);
  const setPendingQuestions = useSessionStore((state) => state.setPendingQuestions);
  const setReasoningSummaries = useSessionStore((state) => state.setReasoningSummaries);
  const addTimelineEntry = useSessionStore((state) => state.addTimelineEntry);
  const setActiveTerminalSessionId = useTerminalStore((state) => state.setActiveSessionId);

  const syncCapturesFromSnapshot = useCallback((snapshot: ContextSnapshot) => {
    if (!snapshot.captureDescriptors?.length) {
      return;
    }

    if (useSessionStore.getState().currentRun) {
      useSessionStore.getState().setCaptures(snapshot.captureDescriptors ?? []);
      return;
    }

    useSessionStore.getState().setCaptures(
      mergeCapturesWithSnapshot(useSessionStore.getState().captures, snapshot),
    );
  }, []);
  const responsiveSidebarState = useMemo(
    () => resolveResponsiveSidebarState(
      appBodyWidth,
      leftSidebarWidth,
      rightPanelWidth,
      leftSidebarCollapsed,
      rightPanelCollapsed,
    ),
    [appBodyWidth, leftSidebarCollapsed, leftSidebarWidth, rightPanelCollapsed, rightPanelWidth],
  );
  const effectiveLeftCollapsed = responsiveSidebarState.leftCollapsed;
  const effectiveRightCollapsed = responsiveSidebarState.rightCollapsed;
  const leftAutoCollapsed = !leftSidebarCollapsed && effectiveLeftCollapsed;
  const rightAutoCollapsed = !rightPanelCollapsed && effectiveRightCollapsed;
  const leftToggleDisabled = leftAutoCollapsed;
  const rightToggleDisabled = rightAutoCollapsed;

  useEffect(() => {
    if (!shellNotice) return;
    const timeoutId = window.setTimeout(() => setShellNotice(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [shellNotice]);

  useEffect(() => {
    setActiveTerminalSessionId(currentSession?.sessionId ?? null);
  }, [currentSession?.sessionId, setActiveTerminalSessionId]);

  useEffect(() => {
    if (!navigator.webdriver) return;

    const target = window as E2EWindow;
    target.__RDC_AGENT_E2E__ = {
      seedWorkbenchState: (state) => {
        const store = useSessionStore.getState();
        store.setProjects(state.projects);
        store.setSessions(state.sessions);
        store.setCurrentProject(state.currentProject);
        store.setCurrentSession(state.currentSession);
        store.setCurrentRun(state.currentRun);
        store.setContextSnapshot(state.contextSnapshot);
        store.setCaptures(state.captures);
        store.setProjectInputs(state.projectInputs);
        store.setOpenedCapture(state.openedCapture);
        store.setTimeline(state.timeline);
        store.setActionEvents(state.actionEvents ?? []);
        store.setWorkflowState(state.workflowState ?? null);
        store.setCurrentDebugPlan(state.workflowState?.debugPlan ?? null);
        store.setPendingQuestions(state.workflowState?.pendingQuestions ?? null);
        store.setReasoningSummaries(state.workflowState?.reasoningSummaries ?? []);
        store.setRuns(state.runs ?? []);
      },
      resetWorkbenchState: () => {
        const store = useSessionStore.getState();
        store.setProjects([]);
        store.setSessions([]);
        store.setCurrentProject(null);
        store.setCurrentSession(null);
        store.setCurrentRun(null);
        store.setContextSnapshot(null);
        store.setCaptures([]);
        store.setProjectInputs([]);
        store.setOpenedCapture(null);
        store.setTimeline([]);
        store.setActionEvents([]);
        store.setWorkflowState(null);
        store.setCurrentDebugPlan(null);
        store.setPendingQuestions(null);
        store.setReasoningSummaries([]);
        store.setRuns([]);
      },
      getWorkbenchState: () => {
        const store = useSessionStore.getState();
        return {
          projects: store.projects,
          sessions: store.sessions,
          currentProject: store.currentProject,
          currentSession: store.currentSession,
          currentRun: store.currentRun,
          contextSnapshot: store.contextSnapshot,
          captures: store.captures,
          projectInputs: store.projectInputs,
          openedCapture: store.openedCapture,
          timeline: store.timeline,
          actionEvents: store.actionEvents,
          workflowState: store.workflowState,
          runs: store.runs,
        };
      },
    };

    return () => {
      delete target.__RDC_AGENT_E2E__;
    };
  }, []);

  useEffect(() => {
    if (!showWorkbenchShell) return;
    const node = appBodyRef.current;
    if (!node) return;

    const syncAppBodyWidth = () => {
      setAppBodyWidth(Math.max(0, Math.round(window.innerWidth)));
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setAppBodyWidth(Math.max(0, Math.round(entry.contentRect.width)));
      }
    });

    observer.observe(node);
    syncAppBodyWidth();
    window.addEventListener('resize', syncAppBodyWidth);
    const intervalId = window.setInterval(syncAppBodyWidth, 160);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', syncAppBodyWidth);
      window.clearInterval(intervalId);
    };
  }, [showWorkbenchShell]);

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
  }, [hydrateLayout, hydrateSettings]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    electronAPI.events.onRunStatusChanged((rawPayload) => {
      const payload = rawPayload as {
        runId: string;
        sessionId: string;
        status: RunSummary['status'];
        lastStage?: string;
        stopReason?: string;
      };
      const current = useSessionStore.getState().currentRun;
      if (!current || current.runId !== payload.runId) {
        return;
      }
      useSessionStore.getState().setCurrentRun({
        ...current,
        status: payload.status,
        lastStage: payload.lastStage || current.lastStage,
        stopReason: payload.stopReason || current.stopReason,
      });
    });

    electronAPI.events.onContextChanged((snapshot) => {
      useSessionStore.getState().setContextSnapshot(snapshot);
      syncCapturesFromSnapshot(snapshot);
    });

    electronAPI.events.onToolExecutionComplete((rawTrace) => {
      const trace = rawTrace as ToolTraceEntry;
      const lastEntry = useSessionStore.getState().timeline[useSessionStore.getState().timeline.length - 1];
      if (lastEntry?.id !== trace.traceId) {
        useSessionStore.getState().addTimelineEntry({
          id: trace.traceId,
          type: 'tool_call',
          content: trace.toolName,
          toolTrace: trace,
          timestamp: trace.timestamp,
        });
      }
    });

    electronAPI.events.onAgentMessage((rawMsg) => {
      const msg = rawMsg as { id?: string; agentRole?: AgentTimelineEntry['agentRole']; content?: string };
      const entry: AgentTimelineEntry = {
        id: msg.id || Date.now().toString(),
        type: 'agent',
        agentRole: msg.agentRole,
        content: msg.content ?? '',
        timestamp: Date.now(),
      };
      useSessionStore.getState().addTimelineEntry(entry);
    });

    electronAPI.events.onCaptureStatusChanged(() => {
      electronAPI.context.get().then((snapshot) => {
        useSessionStore.getState().setContextSnapshot(snapshot);
        syncCapturesFromSnapshot(snapshot);
      }).catch(() => undefined);
    });

    electronAPI.events.onEvidenceEventAdded((rawEvent) => {
      const event = rawEvent as ActionEvent;
      addActionEvent(event);
      const entry = mapActionEventToTimelineEntry(event);
      if (entry) {
        useSessionStore.getState().addTimelineEntry(entry);
      }
    });

    electronAPI.events.onWorkflowStateChanged((rawState) => {
      const state = rawState as WorkflowState;
      setWorkflowState(state);
      setCurrentDebugPlan(state.debugPlan ?? null);
      setPendingQuestions(state.pendingQuestions ?? null);
      setReasoningSummaries(state.reasoningSummaries ?? []);
      const currentProject = useSessionStore.getState().currentProject;
      const currentSession = useSessionStore.getState().currentSession;

      if (currentProject) {
        electronAPI.session.list(currentProject.projectId)
          .then((result) => useSessionStore.getState().setSessions(result.sessions ?? []))
          .catch(() => undefined);
      }

      if (currentSession) {
        electronAPI.run.list(currentSession.sessionId)
          .then((result) => {
            useSessionStore.getState().setRuns(result.runs ?? []);
            const activeRun = result.runs?.find((run) => run.runId === useSessionStore.getState().currentRun?.runId)
              ?? result.runs?.[0]
              ?? null;
            if (activeRun) {
              useSessionStore.getState().setCurrentRun(activeRun);
              useSessionStore.getState().setCaptures(activeRun.captures ?? []);
            }
          })
          .catch(() => undefined);

        electronAPI.evidence.getChain()
          .then((result) => {
            useSessionStore.getState().setActionEvents(result.events ?? []);
            const timeline = (result.events ?? [])
              .map((event) => mapActionEventToTimelineEntry(event as ActionEvent))
              .filter((entry): entry is AgentTimelineEntry => entry !== null);
            useSessionStore.getState().setTimeline(timeline);
          })
          .catch(() => undefined);
      }
    });

    electronAPI.events.onRunStatusChanged((rawPayload) => {
      const payload = rawPayload as {
        runId: string;
        sessionId: string;
        status: RunSummary['status'];
        lastStage?: string;
        stopReason?: string;
      };
      const store = useSessionStore.getState();
      const current = store.currentRun;
      if (current?.runId === payload.runId) {
        store.setCurrentRun({
          ...current,
          status: payload.status,
          lastStage: payload.lastStage || current.lastStage,
          stopReason: payload.stopReason || current.stopReason,
          stoppedAt: ['cancelled', 'interrupted'].includes(payload.status) ? Date.now() : current.stoppedAt,
        });
      }
    });

    electronAPI.events.onDeviceStatusChanged((payload) => {
      useDeviceStore.getState().applyStatusPayload(payload as ReplayDeviceStatusChangedPayload);
    });

    electronAPI.events.onProjectInputsChanged((payload) => {
      const activeProject = useSessionStore.getState().currentProject;
      if (activeProject?.projectId === payload.projectId) {
        useSessionStore.getState().setProjectInputs(payload.inputs);
      }
    });

    electronAPI.events.onOpenedCaptureStateChanged((state) => {
      useSessionStore.getState().setOpenedCapture(state);
    });

    electronAPI.events.onRuntimeLogAppended((entry) => {
      useTerminalStore.getState().appendEntry(entry as RuntimeLogEntry);
    });

    electronAPI.events.onAppThemeChanged((theme) => {
      setSystemTheme(theme);
    });

    void useDeviceStore.getState().loadDevices();
    void electronAPI.capture.getOpenedState()
      .then((state) => useSessionStore.getState().setOpenedCapture(state))
      .catch(() => undefined);
    void electronAPI.context.get()
      .then((snapshot) => useSessionStore.getState().setContextSnapshot(snapshot))
      .catch(() => undefined);

    const handleFileOpen = (paths: unknown) => {
      if (!Array.isArray(paths) || paths.length === 0) return;
      showNotice(t('app.notice.filesReceived', { count: paths.length }));
    };
    const handleCaseNew = () => {
      useSessionStore.getState().reset();
      showNotice(t('app.notice.newWorkspace'));
    };
    const handleSettingsOpen = () => {
      setSettingsModalOpen(true);
    };
    const handleWindowStateChange = (isMaximized: unknown) => {
      setWindowMaximized(Boolean(isMaximized));
    };

    electronAPI.on('file:open', handleFileOpen);
    electronAPI.on('case:new', handleCaseNew);
    electronAPI.on('settings:open', handleSettingsOpen);
    electronAPI.on('window:maximized-changed', handleWindowStateChange);

    return () => {
      electronAPI.off('file:open', handleFileOpen);
      electronAPI.off('case:new', handleCaseNew);
      electronAPI.off('settings:open', handleSettingsOpen);
      electronAPI.off('window:maximized-changed', handleWindowStateChange);
      electronAPI.events.removeAllListeners('context:changed');
      electronAPI.events.removeAllListeners('tool:executionComplete');
      electronAPI.events.removeAllListeners('agent:message');
      electronAPI.events.removeAllListeners('capture:statusChanged');
      electronAPI.events.removeAllListeners('workflow:stateChanged');
      electronAPI.events.removeAllListeners('workflow:runStatusChanged');
      electronAPI.events.removeAllListeners('evidence:eventAdded');
      electronAPI.events.removeAllListeners('device:statusChanged');
      electronAPI.events.removeAllListeners('app:themeChanged');
      electronAPI.events.removeAllListeners('project:inputsChanged');
      electronAPI.events.removeAllListeners('capture:openedStateChanged');
      electronAPI.events.removeAllListeners('runtime:logAppended');
    };
  }, [setSystemTheme, showNotice, syncCapturesFromSnapshot, t]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!currentProject) {
      useSessionStore.getState().setProjectInputs([]);
      return;
    }

    if (navigator.webdriver) {
      const seededInputs = currentProject.inputs?.length
        ? currentProject.inputs
        : useSessionStore.getState().projectInputs;
      useSessionStore.getState().setProjectInputs(seededInputs);
      return;
    }

    if (!electronAPI) {
      useSessionStore.getState().setProjectInputs(currentProject.inputs ?? []);
      return;
    }

    void electronAPI.project.inputs.list(currentProject.projectId)
      .then((result) => {
        useSessionStore.getState().setProjectInputs(result.inputs ?? []);
      })
      .catch(() => {
        useSessionStore.getState().setProjectInputs(currentProject.inputs ?? []);
      });
  }, [currentProject]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (navigator.webdriver) {
      return;
    }

    if (!electronAPI || !currentSession) {
      useSessionStore.getState().setTimeline([]);
      return;
    }

    void electronAPI.evidence.getChain()
      .then((result) => {
        useSessionStore.getState().setActionEvents(result.events ?? []);
        const timeline = (result.events ?? [])
          .map((event) => mapActionEventToTimelineEntry(event as ActionEvent))
          .filter((entry): entry is AgentTimelineEntry => entry !== null);
        useSessionStore.getState().setTimeline(timeline);
      })
      .catch(() => {
        useSessionStore.getState().setActionEvents([]);
        useSessionStore.getState().setTimeline([]);
      });

    void electronAPI.workflow.getState()
      .then((state) => {
        if (!state) {
          useSessionStore.getState().setWorkflowState(null);
          useSessionStore.getState().setCurrentDebugPlan(null);
          useSessionStore.getState().setPendingQuestions(null);
          useSessionStore.getState().setReasoningSummaries([]);
          return;
        }
        const workflow = state as WorkflowState;
        useSessionStore.getState().setWorkflowState(workflow);
        useSessionStore.getState().setCurrentDebugPlan(workflow.debugPlan ?? null);
        useSessionStore.getState().setPendingQuestions(workflow.pendingQuestions ?? null);
        useSessionStore.getState().setReasoningSummaries(workflow.reasoningSummaries ?? []);
      })
      .catch(() => undefined);
  }, [currentSession?.sessionId]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || !appBodyRef.current) return;

      const containerWidth = appBodyRef.current.getBoundingClientRect().width;
      const { left: resolvedLeft, right: resolvedRight } = resolveSidebarWidths(
        containerWidth,
        leftSidebarWidth,
        rightPanelWidth,
        effectiveLeftCollapsed,
        effectiveRightCollapsed,
        getResponsiveMinMainWidth(containerWidth),
      );

      if (dragState.side === 'left' && !effectiveLeftCollapsed) {
        const maxByMain = Math.max(
          LEFT_SIDEBAR_MIN_WIDTH,
          Math.min(
            LEFT_SIDEBAR_MAX_WIDTH,
            containerWidth - getResponsiveMinMainWidth(containerWidth) - APP_RESIZE_HANDLE_WIDTH * 2 - resolvedRight,
          ),
        );
        setLeftSidebarWidth(Math.min(maxByMain, dragState.startWidth + (event.clientX - dragState.startX)));
      }

      if (dragState.side === 'right' && !effectiveRightCollapsed) {
        const maxByMain = Math.max(
          RIGHT_PANEL_MIN_WIDTH,
          Math.min(
            RIGHT_PANEL_MAX_WIDTH,
            containerWidth - getResponsiveMinMainWidth(containerWidth) - APP_RESIZE_HANDLE_WIDTH * 2 - resolvedLeft,
          ),
        );
        setRightPanelWidth(Math.min(maxByMain, dragState.startWidth - (event.clientX - dragState.startX)));
      }
    };

    const handlePointerUp = () => {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      setIsResizing(false);
      void persistLayout();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [
    effectiveLeftCollapsed,
    leftSidebarWidth,
    persistLayout,
    effectiveRightCollapsed,
    rightPanelWidth,
    setLeftSidebarWidth,
    setRightPanelWidth,
  ]);

  const devices = useDeviceStore((state) => state.devices);
  const selectedDevice = useDeviceStore((state) => state.selectedDevice);
  const selectedDeviceEntry = devices.find((device) => device.id === selectedDevice);
  const primaryCapture = captures.find((descriptor) => descriptor.role === 'primary') ?? null;
  const hasRemoteCapture = captures.some((descriptor) => descriptor.backendHint === 'remote');
  const showMainPromptBar = currentMode === 'debugger';
  const resolvedWidths = useMemo(
    () => resolveSidebarWidths(
      appBodyWidth,
      leftSidebarWidth,
      rightPanelWidth,
      effectiveLeftCollapsed,
      effectiveRightCollapsed,
      responsiveSidebarState.minMainWidth,
    ),
    [
      appBodyWidth,
      effectiveLeftCollapsed,
      effectiveRightCollapsed,
      leftSidebarWidth,
      responsiveSidebarState.minMainWidth,
      rightPanelWidth,
    ],
  );

  const handleWindowMinimize = useCallback(async () => {
    await window.electronAPI?.windowControls.minimize();
  }, []);

  const handleWindowToggleMaximize = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;
    const nextState = await electronAPI.windowControls.toggleMaximize();
    setWindowMaximized(nextState);
  }, []);

  const handleWindowClose = useCallback(async () => {
    await window.electronAPI?.windowControls.close();
  }, []);

  const handleUserMenuOpen = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    setUserMenuAnchor(event.currentTarget.getBoundingClientRect());
  }, []);

  const handleUserMenuClose = useCallback(() => {
    setUserMenuAnchor(null);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setUserMenuAnchor(null);
    setSettingsModalOpen(true);
  }, []);

  const handleStopRun = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI || !currentRun) return;

    try {
      await electronAPI.workflow.stop(currentRun.runId);
      showNotice('已请求停止当前调试任务。');
    } catch (error) {
      showNotice(error instanceof Error ? error.message : 'Failed to stop run.');
    }
  }, [currentRun, showNotice]);

  const handlePromptSend = useCallback(async () => {
    const trimmed = promptValue.trim();
    if (!trimmed || isPromptSending) return;

    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    if (!currentRun) {
      if (!currentProject) {
        showNotice('请先添加并选择一个项目。');
        return;
      }

      if (!selectedDeviceEntry) {
        showNotice('请先选择 Replay Device。');
        return;
      }

      if (hasRemoteCapture && selectedDeviceEntry.type === 'local') {
        showNotice('远端 capture 需要选择 Android Replay Device。');
        return;
      }

      setIsPromptSending(true);
      try {
        if (
          hasRemoteCapture
          && selectedDeviceEntry.type === 'android'
          && !['connected', 'online'].includes(selectedDeviceEntry.status)
        ) {
          showNotice('正在连接 Android RenderDoc…');
        }

        const request: DebugSessionStartRequest = {
          projectId: currentProject.projectId,
          sessionId: currentSession?.sessionId,
          mode: 'debugger',
          goal: trimmed,
          captures: captures.length > 0 ? captures : undefined,
          primaryCaptureId: primaryCapture?.id,
          replayDevice: selectedDeviceEntry,
        };

        const result = await electronAPI.workflow.start(request);
        if (!result.success) {
          showNotice(result.error || 'Failed to start debug session.');
          return;
        }

        setCurrentRun({
          runId: result.runId ?? `run-${Date.now()}`,
          projectId: currentProject.projectId,
          caseId: result.caseId ?? '',
          sessionId: result.sessionId ?? '',
          mode: 'debugger',
          goal: trimmed,
          captures: captures.length > 0 ? captures : (result.debugPlanSummary?.targetCapture
            ? [{
                id: result.debugPlanSummary.targetCapture.captureId,
                filePath: result.debugPlanSummary.targetCapture.filePath,
                role: 'primary',
                backendHint: 'local',
                status: 'pending',
              }]
            : []),
          startedAt: Date.now(),
          status: result.status ?? 'planning',
          lastStage: result.currentStage ?? 'plan',
          backend: captures.some((descriptor) => descriptor.backendHint === 'remote') ? 'remote' : 'local',
        });

        if (result.sessionId) {
          const sessionsResult = await electronAPI.session.list(currentProject.projectId);
          const nextSessions = sessionsResult.sessions ?? [];
          setSessions(nextSessions);
          const matchedSession = nextSessions.find((session) => session.sessionId === result.sessionId) ?? null;
          setCurrentSession(matchedSession);
          const runsResult = await electronAPI.run.list(result.sessionId);
          setRuns(runsResult.runs ?? []);
        }

        setPromptValue('');
        return;
      } catch (error) {
        showNotice(error instanceof Error ? error.message : 'Failed to start debug session.');
        return;
      } finally {
        setIsPromptSending(false);
      }
    }

    if (currentRun) {
      setIsPromptSending(true);
      try {
        addTimelineEntry({
          id: `user-${Date.now()}`,
          type: 'user',
          content: trimmed,
          timestamp: Date.now(),
        });
        const result = await electronAPI.agent.sendMessage('rdc-debugger', trimmed);
        if (result.error) {
          showNotice(result.error);
        } else {
          setPromptValue('');
        }
      } catch (error) {
        showNotice(error instanceof Error ? error.message : 'Agent request failed.');
      } finally {
        setIsPromptSending(false);
      }
      return;
    }

  }, [
    addTimelineEntry,
    captures,
    currentProject,
    currentRun,
    currentSession,
    hasRemoteCapture,
    isPromptSending,
    primaryCapture,
    promptValue,
    selectedDeviceEntry,
    setCaptures,
    setContextSnapshot,
    setCurrentRun,
    setCurrentSession,
    setRuns,
    setSessions,
    showNotice,
  ]);

  const handlePromptKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void handlePromptSend();
    }
  }, [handlePromptSend]);

  const startDragging = useCallback((side: DragSide, startWidth: number) => (event: React.PointerEvent<HTMLDivElement>) => {
    dragStateRef.current = {
      side,
      startX: event.clientX,
      startWidth,
    };
    setIsResizing(true);
  }, []);

  const renderMainPage = () => (currentMode === 'debugger' ? <DebuggerPage /> : <PlaceholderModePage mode={currentMode} />);

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-logo">RD</div>
        <div className="loading-text">Loading RDC Agent shell...</div>
        <div className="loading-bar" />
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-titlebar">
        <div className="app-titlebar-left no-drag">
          <div className="app-logo">
            <div className="app-logo-icon">RD</div>
            <div className="app-logo-copy">
              <span className="app-logo-text">RDC Agent</span>
            </div>
          </div>
        </div>
        <div className="app-titlebar-center no-drag">
          <div className="mode-switcher" role="tablist" aria-label="Mode switcher">
            {AGENT_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={`mode-switcher-item ${currentMode === mode.id ? 'active' : ''}`}
                role="tab"
                aria-selected={currentMode === mode.id}
                onClick={() => setCurrentMode(mode.id)}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </div>
        <div className="app-titlebar-right no-drag">
          <div className="window-controls" role="group" aria-label="Window controls">
            <button
              type="button"
              className="window-control window-control-minimize tooltip"
              data-tooltip="Minimize"
              aria-label="Minimize window"
              onClick={handleWindowMinimize}
            >
              <span className="minimize" />
            </button>
            <button
              type="button"
              className="window-control window-control-maximize tooltip"
              data-tooltip={windowMaximized ? 'Restore' : 'Maximize'}
              aria-label={windowMaximized ? 'Restore window' : 'Maximize window'}
              onClick={handleWindowToggleMaximize}
            >
              <span className={windowMaximized ? 'restore' : 'maximize'} />
            </button>
            <button
              type="button"
              className="window-control close tooltip"
              data-tooltip="Close"
              aria-label="Close window"
              onClick={handleWindowClose}
            >
              <span className="close-mark" />
            </button>
          </div>
        </div>
      </header>

      {showWorkbenchShell ? (
        <div
          ref={appBodyRef}
          className={`app-body ${isResizing ? 'is-resizing' : ''}`}
          style={{
            ['--left-sidebar-width' as string]: `${resolvedWidths.left}px`,
            ['--right-panel-width' as string]: `${resolvedWidths.right}px`,
            ['--resize-handle-width' as string]: `${APP_RESIZE_HANDLE_WIDTH}px`,
          }}
        >
          <aside
            className={`app-sidebar-left ${effectiveLeftCollapsed ? 'collapsed' : ''}`}
            data-testid="app-sidebar-left"
          >
            <div className="shell-panel-header shell-panel-header-left">
              <button
                type="button"
                className="shell-panel-toggle"
                onClick={!leftToggleDisabled ? () => void toggleLeftSidebar() : undefined}
                aria-label={effectiveLeftCollapsed ? 'Expand left sidebar' : 'Collapse left sidebar'}
                title={leftToggleDisabled ? '窗口过窄，左侧栏已自动收起' : (effectiveLeftCollapsed ? '展开左侧栏' : '收起左侧栏')}
                disabled={leftToggleDisabled}
              >
                <span className="shell-panel-toggle-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {effectiveLeftCollapsed ? (
                      <polyline points="9 18 15 12 9 6" />
                    ) : (
                      <polyline points="15 18 9 12 15 6" />
                    )}
                  </svg>
                </span>
              </button>
            </div>
            <nav className="sidebar-nav">
              <Sidebar collapsed={effectiveLeftCollapsed} />
            </nav>
            <div
              className={`app-sidebar-footer ${effectiveLeftCollapsed ? 'collapsed' : ''}`}
              data-testid="sidebar-footer"
            >
              <button
                type="button"
                className={`footer-entry footer-user-trigger sidebar-user-trigger sidebar-footer-entry ${effectiveLeftCollapsed ? 'collapsed' : ''}`}
                data-testid="sidebar-user-settings-trigger"
                onClick={handleUserMenuOpen}
                title={t('sidebar.userSettings')}
                aria-label={t('sidebar.userSettings')}
              >
                <span className="footer-entry-avatar">
                  {nickname.trim().slice(0, 2).toUpperCase()}
                </span>
                {!effectiveLeftCollapsed && (
                  <>
                    <span className="footer-entry-copy">
                      <span className="footer-entry-title">{nickname}</span>
                      <span className="footer-entry-subtitle">{t('sidebar.userSubtitle')}</span>
                    </span>
                    <span className="footer-entry-chevron">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </span>
                  </>
                )}
              </button>
              <DeviceSelector collapsed={effectiveLeftCollapsed} />
            </div>
          </aside>

          <div
            className={`panel-resize-handle panel-resize-handle-left ${effectiveLeftCollapsed ? 'disabled' : ''}`}
            onPointerDown={!effectiveLeftCollapsed ? startDragging('left', resolvedWidths.left) : undefined}
            aria-hidden="true"
          />

          <main className="app-main">
            <div className="main-content">
              {shellNotice && (
                <div className="shell-notice" role="status" aria-live="polite">
                  {shellNotice}
                </div>
              )}
              <div className="main-utility-bar">
                <div className="main-utility-spacer" />
                <button
                  type="button"
                  className={`main-utility-toggle ${isTerminalOpen ? 'active' : ''}`}
                  onClick={() => toggleTerminalOpen()}
                  data-testid="terminal-toggle"
                  aria-label={isTerminalOpen ? t('terminal.close') : t('terminal.open')}
                  title={isTerminalOpen ? t('terminal.close') : t('terminal.open')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 17l6-6-6-6" />
                    <path d="M12 19h8" />
                  </svg>
                  <span>{t('terminal.title')}</span>
                </button>
              </div>
              <div className="main-page-shell">
                {renderMainPage()}
              </div>
            </div>
            {showMainPromptBar && (
              <div className="main-input-bar">
                <div className="chat-input-wrapper">
                  <input
                    type="text"
                    className="chat-input"
                    name="debuggerPrompt"
                    value={promptValue}
                    onChange={(event) => setPromptValue(event.target.value)}
                    onKeyDown={handlePromptKeyDown}
                    placeholder={workflowState?.approvalState === 'pending_user'
                      ? 'Plan is ready. Approve it in the intake panel to start execution.'
                      : t('app.inputPlaceholder')}
                    aria-label={workflowState?.approvalState === 'pending_user'
                      ? 'Plan is ready. Approve it in the intake panel to start execution.'
                      : t('app.inputPlaceholder')}
                  />
                  {currentRun && ['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running', 'stopping'].includes(currentRun.status) && (
                    <button
                      type="button"
                      className="chat-send-button chat-stop-button"
                      data-testid="debugger-stop-button"
                      onClick={() => void handleStopRun()}
                      disabled={currentRun.status === 'stopping'}
                      aria-label="Stop debugger run"
                      title="停止当前调试"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <rect x="6" y="6" width="12" height="12" rx="1" />
                      </svg>
                    </button>
                  )}
                  <button
                    type="button"
                    className="chat-send-button"
                    data-testid={currentRun ? 'debugger-send-button' : 'debugger-start-button'}
                    onClick={() => void handlePromptSend()}
                    disabled={!promptValue.trim() || isPromptSending}
                    aria-label={currentRun ? 'Send debugger message' : 'Start debugger session'}
                    title={currentRun ? '发送消息' : '启动 Debugger'}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="22" y1="2" x2="11" y2="13" />
                      <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                  </button>
                </div>
              </div>
            )}
            <TerminalDrawer />
          </main>

          <div
            className={`panel-resize-handle panel-resize-handle-right ${effectiveRightCollapsed ? 'disabled' : ''}`}
            onPointerDown={!effectiveRightCollapsed ? startDragging('right', resolvedWidths.right) : undefined}
            aria-hidden="true"
          />

          <aside
            className={`app-sidebar-right ${effectiveRightCollapsed ? 'collapsed' : ''}`}
            data-testid="app-sidebar-right"
          >
            <div className="shell-panel-header shell-panel-header-right">
              <button
                type="button"
                className="shell-panel-toggle"
                onClick={!rightToggleDisabled ? () => void toggleRightPanel() : undefined}
                aria-label={effectiveRightCollapsed ? 'Expand right panel' : 'Collapse right panel'}
                title={rightToggleDisabled ? '窗口过窄，右侧栏已自动收起' : (effectiveRightCollapsed ? '展开右侧栏' : '收起右侧栏')}
                disabled={rightToggleDisabled}
              >
                <span className="shell-panel-toggle-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {effectiveRightCollapsed ? (
                      <polyline points="9 18 15 12 9 6" />
                    ) : (
                      <polyline points="15 18 9 12 15 6" />
                    )}
                  </svg>
                </span>
              </button>
            </div>
            <div
              className={`right-panel-body ${effectiveRightCollapsed ? 'collapsed' : ''}`}
              data-testid="control-panel-scroll"
            >
              <ControlPanel />
            </div>
          </aside>
        </div>
      ) : (
        <div className="app-main app-mode-placeholder">
          <div className="main-content">
            <div className="main-page-shell">
              {renderMainPage()}
            </div>
          </div>
        </div>
      )}

      <UserMenu
        anchorRect={userMenuAnchor}
        open={Boolean(userMenuAnchor)}
        settings={settings}
        onClose={handleUserMenuClose}
        onOpenSettings={handleOpenSettings}
        onThemeChange={(theme) => void setTheme(theme)}
        onLanguageChange={(language) => void setLanguage(language)}
        onFontScaleChange={(fontScale) => void setFontScale(fontScale)}
      />

      <SettingsModal
        open={settingsModalOpen}
        settings={settings}
        onClose={() => setSettingsModalOpen(false)}
      />
    </div>
  );
};

export default App;
