import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DebuggerPage } from './pages/Debugger';
import { ControlPanel } from './features/debugger/ControlPanel';
import { DeviceSelector } from './features/captures/DeviceSelector';
import { Sidebar } from './features/projects/Sidebar';
import { UserMenu } from './shell/UserMenu';
import { SettingsModal } from './features/settings/SettingsModal';
import { TerminalDrawer } from './features/terminal/TerminalDrawer';
import { ModeGlyph } from './ui/ModeGlyph';
import { ProfileAvatar } from './ui/ProfileAvatar';
import { PlanIntakePanel } from './features/debugger/PlanIntakePanel';
import { useLayoutStore } from './stores/layoutStore';
import { useSessionStore, type RightRailTarget } from './stores/sessionStore';
import { useDeviceStore } from './stores/deviceStore';
import { useAppSettingsStore } from './stores/appSettingsStore';
import { useTerminalStore } from './stores/terminalStore';
import { useI18n } from './i18n';
import { ContextUsageIndicator } from './patterns/ContextUsageIndicator';
import {
  getResponsiveMinMainWidth,
  getWorkbenchContentRailWidth,
  getWorkbenchRailMaxWidth,
  resolveResponsiveSidebarState,
  resolveSidebarWidths,
} from './shell/layoutGeometry';
import {
  applyActionEventToMessage,
  applyToolTraceToMessage,
  hydrateMessagesWithActionEvents,
  mapActionEventToTimelineEntry,
  mergeCapturesWithSnapshot,
} from './shell/conversationTimeline';
import {
  formatBytes,
  inferAttachmentKind,
  inferAttachmentMimeType,
} from './shell/attachmentHelpers';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type {
  ConversationAttachmentInput,
  ConversationMessage,
  ConversationStreamEvent,
} from '@shared/types/conversation';
import type { ToolTraceEntry } from '@shared/types/tool';
import type { ReplayDeviceStatusChangedPayload } from '@shared/types/device';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import type { AppSettings, ResolvedTheme } from '@shared/types/settings';
import type { ActionEvent } from '@shared/types/evidence';
import type { AgentMode } from '@shared/types/layout';
import type {
  CaptureDescriptor,
  ContextSnapshot,
  OpenedCaptureState,
  ProjectInputRecord,
  ProjectRecord,
  RunContextUsageSummary,
  RunSummary,
  SessionAttachmentRecord,
  SessionRecord,
} from '@shared/types/session';
import type { WorkflowState } from '@shared/types/workflow';
import { AGENT_MODES } from '@shared/constants/agents';
import {
  APP_RESIZE_HANDLE_WIDTH,
  LEFT_SIDEBAR_MAX_WIDTH,
  LEFT_SIDEBAR_MIN_WIDTH,
  RIGHT_PANEL_MAX_WIDTH,
  RIGHT_PANEL_MIN_WIDTH,
} from '@shared/constants/layout';

type DragSide = 'left' | 'right';
type RightRailMode = 'hidden' | 'project' | 'session';

interface PendingAttachmentDraft extends ConversationAttachmentInput {
  id: string;
  kind: SessionAttachmentRecord['kind'];
  isCapture: boolean;
}

interface WorkbenchSeedState {
  projects: ProjectRecord[];
  sessions: SessionRecord[];
  currentProject: ProjectRecord | null;
  currentSession: SessionRecord | null;
  rightRailTarget?: RightRailTarget;
  currentRun: RunSummary | null;
  currentRunUsage?: RunContextUsageSummary | null;
  contextSnapshot: ContextSnapshot | null;
  captures: CaptureDescriptor[];
  projectInputs: ProjectInputRecord[];
  openedCapture: OpenedCaptureState | null;
  conversationMessages?: ConversationMessage[];
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
    setAppSettings: (settings: AppSettings) => void;
    setComposerDraftState: (state: {
      promptValue?: string;
      pendingAttachments?: PendingAttachmentDraft[];
      currentMode?: AgentMode;
    }) => void;
  };
};

const App: React.FC = () => {
  const { t, language } = useI18n();
  const [isLoading, setIsLoading] = useState(true);
  const [, setConnectionStatus] = useState<'connected' | 'degraded' | 'offline'>('offline');
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [shellNotice, setShellNotice] = useState<string | null>(null);
  const [userMenuAnchor, setUserMenuAnchor] = useState<DOMRect | null>(null);
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [runtimeTestMode, setRuntimeTestMode] = useState<boolean | null>(null);
  const [appBodyWidth, setAppBodyWidth] = useState(0);
  const [isResizing, setIsResizing] = useState(false);
  const [promptValue, setPromptValue] = useState('');
  const [isPromptSending, setIsPromptSending] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachmentDraft[]>([]);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);

  const appBodyRef = useRef<HTMLDivElement>(null);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const modeMenuRef = useRef<HTMLDivElement>(null);
  const dragStateRef = useRef<{ side: DragSide; startX: number; startWidth: number } | null>(null);

  const currentProject = useSessionStore((state) => state.currentProject);
  const currentSession = useSessionStore((state) => state.currentSession);
  const rightRailTarget = useSessionStore((state) => state.rightRailTarget);
  const currentRun = useSessionStore((state) => state.currentRun);
  const currentRunUsage = useSessionStore((state) => state.currentRunUsage);
  const openedCapture = useSessionStore((state) => state.openedCapture);
  const conversationMessages = useSessionStore((state) => state.conversationMessages);
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
  const avatarPath = settings.profile.avatarPath;
  const showWorkbenchShell = true;
  const hasOpenedCaptureForCurrentProject = Boolean(
    currentProject
    && openedCapture?.projectId === currentProject.projectId
    && openedCapture.status === 'open',
  );
  const hasActiveDebugRun = Boolean(currentRun && ['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running', 'stopping'].includes(currentRun.status));
  const hasActiveConversationTurn = conversationMessages.some(
    (message) => message.role === 'assistant' && (message.status === 'draft' || message.status === 'streaming'),
  );
  const isComposerBusy = isPromptSending || hasActiveConversationTurn || hasActiveDebugRun;
  const rightRailMode: RightRailMode = !currentProject
    ? 'hidden'
    : rightRailTarget === 'session' && currentSession
      ? 'session'
      : 'project';
  const isRightRailVisible = rightRailMode !== 'hidden';
  const isTerminalOpen = useTerminalStore((state) => state.isOpen);
  const toggleTerminalOpen = useTerminalStore((state) => state.toggleOpen);
  const activityEntries = useTerminalStore((state) => state.entries);

  const showNotice = useCallback((message: string) => {
    setShellNotice(message);
  }, []);

  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setCurrentRunUsage = useSessionStore((state) => state.setCurrentRunUsage);
  const setSessions = useSessionStore((state) => state.setSessions);
  const setCurrentSession = useSessionStore((state) => state.setCurrentSession);
  const setRuns = useSessionStore((state) => state.setRuns);
  const addActionEvent = useSessionStore((state) => state.addActionEvent);
  const setWorkflowState = useSessionStore((state) => state.setWorkflowState);
  const setCurrentDebugPlan = useSessionStore((state) => state.setCurrentDebugPlan);
  const setPendingQuestions = useSessionStore((state) => state.setPendingQuestions);
  const setReasoningSummaries = useSessionStore((state) => state.setReasoningSummaries);
  const setConversationMessages = useSessionStore((state) => state.setConversationMessages);
  const upsertConversationMessages = useSessionStore((state) => state.upsertConversationMessages);
  const setActiveTerminalContext = useTerminalStore((state) => state.setActiveContext);

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
      isRightRailVisible,
    ),
    [appBodyWidth, isRightRailVisible, leftSidebarCollapsed, leftSidebarWidth, rightPanelCollapsed, rightPanelWidth],
  );
  const effectiveLeftCollapsed = responsiveSidebarState.leftCollapsed;
  const effectiveRightCollapsed = isRightRailVisible ? responsiveSidebarState.rightCollapsed : true;
  const bothSidebarsCollapsed = effectiveLeftCollapsed && (!isRightRailVisible || effectiveRightCollapsed);
  const workbenchRailMaxWidth = getWorkbenchRailMaxWidth(
    effectiveLeftCollapsed,
    effectiveRightCollapsed,
    isRightRailVisible,
  );
  const workbenchContentRailWidth = getWorkbenchContentRailWidth(
    effectiveLeftCollapsed,
    effectiveRightCollapsed,
    isRightRailVisible,
  );
  const leftAutoCollapsed = !leftSidebarCollapsed && effectiveLeftCollapsed;
  const rightAutoCollapsed = isRightRailVisible && !rightPanelCollapsed && effectiveRightCollapsed;
  const leftToggleDisabled = leftAutoCollapsed;
  const rightToggleDisabled = !isRightRailVisible || rightAutoCollapsed;

  useEffect(() => {
    if (!shellNotice) return;
    const timeoutId = window.setTimeout(() => setShellNotice(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [shellNotice]);

  useEffect(() => {
    setPendingAttachments([]);
  }, [currentProject?.projectId]);

  useEffect(() => {
    if (currentMode !== 'ask' && !hasOpenedCaptureForCurrentProject) {
      setCurrentMode('ask');
    }
  }, [currentMode, hasOpenedCaptureForCurrentProject, setCurrentMode]);

  useEffect(() => {
    if (!modeMenuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!modeMenuRef.current?.contains(target)) {
        setModeMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModeMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [modeMenuOpen]);

  useEffect(() => {
    const textarea = promptInputRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = '0px';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [currentMode, promptValue]);

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

    void (async () => {
      const [historyResult, evidenceResult] = await Promise.all([
        electronAPI.conversation.getHistory(currentSession.sessionId).catch(() => ({ messages: [] })),
        electronAPI.evidence.getChain().catch(() => ({ events: [] as ActionEvent[] })),
      ]);
      setConversationMessages(hydrateMessagesWithActionEvents(
        historyResult.messages ?? [],
        (evidenceResult.events ?? []) as ActionEvent[],
      ));
    })();
  }, [currentSession?.sessionId, setConversationMessages]);

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
        store.setRightRailTarget(state.rightRailTarget ?? (state.currentSession ? 'session' : 'project'));
        store.setCurrentRun(state.currentRun);
        store.setCurrentRunUsage(state.currentRunUsage ?? null);
        store.setContextSnapshot(state.contextSnapshot);
        store.setCaptures(state.captures);
        store.setProjectInputs(state.projectInputs);
        if (state.currentProject) {
          store.updateProjectInputs(state.currentProject.projectId, state.projectInputs);
        }
        store.setOpenedCapture(state.openedCapture);
        store.setConversationMessages(state.conversationMessages ?? []);
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
        store.setRightRailTarget('project');
        store.setCurrentRun(null);
        store.setCurrentRunUsage(null);
        store.setContextSnapshot(null);
        store.setCaptures([]);
        store.setProjectInputs([]);
        store.setOpenedCapture(null);
        store.setConversationMessages([]);
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
          rightRailTarget: store.rightRailTarget,
          currentRun: store.currentRun,
          currentRunUsage: store.currentRunUsage,
          contextSnapshot: store.contextSnapshot,
          captures: store.captures,
          projectInputs: store.projectInputs,
          openedCapture: store.openedCapture,
          conversationMessages: store.conversationMessages,
          timeline: store.timeline,
          actionEvents: store.actionEvents,
          workflowState: store.workflowState,
          runs: store.runs,
        };
      },
      setAppSettings: (nextSettings) => {
        useAppSettingsStore.getState().hydrate(nextSettings, useAppSettingsStore.getState().systemTheme);
      },
      setComposerDraftState: (state) => {
        if (typeof state.promptValue === 'string') {
          setPromptValue(state.promptValue);
        }
        if (Array.isArray(state.pendingAttachments)) {
          setPendingAttachments(state.pendingAttachments);
        }
        if (state.currentMode) {
          useLayoutStore.getState().setCurrentMode(state.currentMode);
        }
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
  }, [hydrateLayout, hydrateSettings]);

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

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    const unsubscribeRunUsageChanged = electronAPI.events.onRunUsageChanged((summary) => {
      const activeRun = useSessionStore.getState().currentRun;
      if (activeRun?.runId === summary.runId) {
        useSessionStore.getState().setCurrentRunUsage(summary);
      }
    });

    const unsubscribeContextChanged = electronAPI.events.onContextChanged((snapshot) => {
      useSessionStore.getState().setContextSnapshot(snapshot);
      syncCapturesFromSnapshot(snapshot);
    });

    const handleConversationEvent = (event: ConversationStreamEvent) => {
      const store = useSessionStore.getState();
      if (event.type === 'run_linked') {
        store.patchAssistantMessageByTurnId(event.turnId, { runId: event.runId });
        return;
      }
      store.upsertConversationMessage(event.message);
    };

    electronAPI.conversation.onEvent(handleConversationEvent);

    const unsubscribeToolExecutionComplete = electronAPI.events.onToolExecutionComplete((rawTrace) => {
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
      if (trace.turnId) {
        useSessionStore.getState().updateAssistantMessageByTurnId(trace.turnId, (message) => applyToolTraceToMessage(message, trace));
      }
    });

    const unsubscribeAgentMessage = electronAPI.events.onAgentMessage((rawMsg) => {
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

    const unsubscribeCaptureStatusChanged = electronAPI.events.onCaptureStatusChanged(() => {
      electronAPI.context.get().then((snapshot) => {
        useSessionStore.getState().setContextSnapshot(snapshot);
        syncCapturesFromSnapshot(snapshot);
      }).catch(() => undefined);
    });

    const unsubscribeEvidenceEventAdded = electronAPI.events.onEvidenceEventAdded((rawEvent) => {
      const event = rawEvent as ActionEvent;
      addActionEvent(event);
      const entry = mapActionEventToTimelineEntry(event);
      if (entry) {
        useSessionStore.getState().addTimelineEntry(entry);
      }
      if (event.turn_id) {
        useSessionStore.getState().updateAssistantMessageByTurnId(event.turn_id, (message) => applyActionEventToMessage(message, event));
      }
    });

    const unsubscribeWorkflowStateChanged = electronAPI.events.onWorkflowStateChanged((rawState) => {
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
            const targetRunId = state.runId || useSessionStore.getState().currentRun?.runId;
            const activeRun = result.runs?.find((run) => run.runId === targetRunId)
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
            useSessionStore.getState().setConversationMessages(
              hydrateMessagesWithActionEvents(
                useSessionStore.getState().conversationMessages,
                (result.events ?? []) as ActionEvent[],
              ),
            );
          })
          .catch(() => undefined);
      }
    });

    const unsubscribeRunStatusChanged = electronAPI.events.onRunStatusChanged((rawPayload) => {
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
        if (!['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running', 'stopping'].includes(payload.status)) {
          store.setCurrentRunUsage(null);
        }
      }
    });

    const unsubscribeDeviceStatusChanged = electronAPI.events.onDeviceStatusChanged((payload) => {
      useDeviceStore.getState().applyStatusPayload(payload as ReplayDeviceStatusChangedPayload);
    });

    const unsubscribeProjectInputsChanged = electronAPI.events.onProjectInputsChanged((payload) => {
      useSessionStore.getState().updateProjectInputs(payload.projectId, payload.inputs);
    });

    const unsubscribeOpenedCaptureStateChanged = electronAPI.events.onOpenedCaptureStateChanged((state) => {
      useSessionStore.getState().setOpenedCapture(state);
    });

    const unsubscribeRuntimeLogAppended = electronAPI.events.onRuntimeLogAppended((entry) => {
      useTerminalStore.getState().appendEntry(entry as RuntimeLogEntry);
    });

    const unsubscribeAppThemeChanged = electronAPI.events.onAppThemeChanged((theme) => {
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
      unsubscribeRunUsageChanged();
      unsubscribeContextChanged();
      unsubscribeToolExecutionComplete();
      unsubscribeAgentMessage();
      unsubscribeCaptureStatusChanged();
      unsubscribeEvidenceEventAdded();
      unsubscribeWorkflowStateChanged();
      unsubscribeRunStatusChanged();
      unsubscribeDeviceStatusChanged();
      unsubscribeProjectInputsChanged();
      unsubscribeOpenedCaptureStateChanged();
      unsubscribeRuntimeLogAppended();
      unsubscribeAppThemeChanged();
      electronAPI.conversation.offEvent(handleConversationEvent);
      electronAPI.off('file:open', handleFileOpen);
      electronAPI.off('case:new', handleCaseNew);
      electronAPI.off('settings:open', handleSettingsOpen);
      electronAPI.off('window:maximized-changed', handleWindowStateChange);
    };
  }, [setSystemTheme, showNotice, syncCapturesFromSnapshot, t]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!currentProject) {
      useSessionStore.getState().setProjectInputs([]);
      return;
    }

    if (runtimeTestMode === null) {
      return;
    }

    if (navigator.webdriver && runtimeTestMode) {
      const seededInputs = currentProject.inputs?.length
        ? currentProject.inputs
        : useSessionStore.getState().projectInputs;
      useSessionStore.getState().updateProjectInputs(currentProject.projectId, seededInputs);
      return;
    }

    if (!electronAPI) {
      useSessionStore.getState().updateProjectInputs(currentProject.projectId, currentProject.inputs ?? []);
      return;
    }

    void electronAPI.project.inputs.list(currentProject.projectId)
      .then((result) => {
        useSessionStore.getState().updateProjectInputs(currentProject.projectId, result.inputs ?? []);
      })
      .catch(() => {
        useSessionStore.getState().updateProjectInputs(currentProject.projectId, currentProject.inputs ?? []);
      });
  }, [currentProject, runtimeTestMode]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (runtimeTestMode === null) {
      return;
    }

    if (navigator.webdriver && runtimeTestMode) {
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
        useSessionStore.getState().setConversationMessages(
          hydrateMessagesWithActionEvents(
            useSessionStore.getState().conversationMessages,
            (result.events ?? []) as ActionEvent[],
          ),
        );
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
  }, [currentSession?.sessionId, runtimeTestMode]);

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
        isRightRailVisible,
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
    isRightRailVisible,
    rightPanelWidth,
    setLeftSidebarWidth,
    setRightPanelWidth,
  ]);

  const devices = useDeviceStore((state) => state.devices);
  const selectedDevice = useDeviceStore((state) => state.selectedDevice);
  const selectedDeviceEntry = devices.find((device) => device.id === selectedDevice);
  const showMainPromptBar = true;
  const hasMessageContent = Boolean(promptValue.trim());
  const hasPendingAttachments = pendingAttachments.length > 0;
  const currentModeConfig = AGENT_MODES.find((mode) => mode.id === currentMode) ?? AGENT_MODES[0];
  const modeLabels = useMemo<Record<AgentMode, string>>(() => ({
    ask: t('mode.ask'),
    debugger: t('mode.debugger'),
    analyzer: t('mode.analyzer'),
    optimizer: t('mode.optimizer'),
  }), [t]);
  const currentModeLabel = modeLabels[currentMode];
  const promptPlaceholder = currentMode === 'ask'
    ? (language === 'zh-CN'
      ? '向 Ask 描述问题、目标或需要打开的 .rdc Capture'
      : 'Ask about the issue, goal, or .rdc capture to open')
    : (language === 'zh-CN'
      ? `向 ${currentModeLabel} 描述目标、异常或验证需求`
      : `Describe the goal, anomaly, or verification request for ${currentModeLabel}`);
  const attachButtonLabel = !currentProject
    ? (language === 'zh-CN'
      ? '选择项目后可附加图片、文件或 .rdc Capture'
      : 'Select a project before attaching images, files, or .rdc captures')
    : (language === 'zh-CN'
      ? '附加图片、文件或 .rdc Capture'
      : 'Attach images, files, or .rdc captures');
  const sendButtonLabel = language === 'zh-CN' ? '发送' : 'Send';
  const startButtonLabel = language === 'zh-CN' ? '开始' : 'Start';
  const stopButtonLabel = hasActiveDebugRun
    ? (language === 'zh-CN' ? '停止当前调试' : 'Stop current debug run')
    : (language === 'zh-CN' ? '停止当前请求' : 'Stop current request');
  const primaryButtonLabel = isComposerBusy ? stopButtonLabel : (currentMode === 'ask' || hasActiveDebugRun ? sendButtonLabel : startButtonLabel);
  const primaryButtonDescription = isComposerBusy
    ? stopButtonLabel
    : language === 'zh-CN'
      ? `${primaryButtonLabel}${currentModeLabel}消息`
      : `${primaryButtonLabel} ${currentModeLabel} message`;
  const primaryButtonDisabled = isComposerBusy
    ? currentRun?.status === 'stopping' && !hasActiveConversationTurn && !isPromptSending
    : (!hasMessageContent && !hasPendingAttachments);
  const openCaptureRequiredLabel = language === 'zh-CN'
    ? '先在应用内 Open 一个 .rdc Capture 后才能选择执行模式'
    : 'Open a .rdc capture in the app before selecting an execution mode';
  const activityAlertSeverity = activityEntries.some((entry) => entry.severity === 'error')
    ? 'error'
    : activityEntries.some((entry) => entry.severity === 'warning')
      ? 'warning'
      : hasActiveDebugRun
        ? 'running'
        : null;
  const leftPanelToggleLabel = effectiveLeftCollapsed ? t('app.leftSidebarExpand') : t('app.leftSidebarCollapse');
  const rightPanelToggleLabel = effectiveRightCollapsed ? t('app.rightPanelExpand') : t('app.rightPanelCollapse');
  const autoCollapsedTitle = t('app.panelAutoCollapsed');
  const resolvedWidths = useMemo(
    () => resolveSidebarWidths(
      appBodyWidth,
      leftSidebarWidth,
      rightPanelWidth,
      effectiveLeftCollapsed,
      effectiveRightCollapsed,
      responsiveSidebarState.minMainWidth,
      isRightRailVisible,
    ),
    [
      appBodyWidth,
      effectiveLeftCollapsed,
      effectiveRightCollapsed,
      isRightRailVisible,
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

  const handlePrimaryStop = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    try {
      const stopPromises: Array<Promise<{ success: boolean; error?: string }>> = [
        electronAPI.conversation.cancelActiveTurn({
          sessionId: currentSession?.sessionId,
        }),
      ];

      if (currentRun && ['planning', 'awaiting_input', 'awaiting_approval', 'queued', 'running'].includes(currentRun.status)) {
        setCurrentRun({
          ...currentRun,
          status: 'stopping',
        });
        stopPromises.push(electronAPI.workflow.stop(currentRun.runId));
      }

      const results = await Promise.allSettled(stopPromises);
      const failures = results
        .map((result) => (result.status === 'fulfilled' ? result.value : { success: false, error: String(result.reason) }))
        .filter((result) => !result.success);
      setIsPromptSending(false);
      if (failures.length > 0 && failures.some((failure) => failure.error && !failure.error.includes('No active conversation'))) {
        showNotice(failures.find((failure) => failure.error)?.error ?? t('app.stopRunFailed'));
        return;
      }
      showNotice(t('app.stopRunSent'));
    } catch (error) {
      showNotice(error instanceof Error ? error.message : t('app.stopRunFailed'));
    }
  }, [currentRun, currentSession?.sessionId, setCurrentRun, showNotice, t]);

  const handleAttachmentSelect = useCallback(async () => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      return;
    }

    if (!currentProject) {
      if (effectiveLeftCollapsed && !leftToggleDisabled) {
        void toggleLeftSidebar();
      }
      showNotice(t('app.attachProjectRequired'));
      return;
    }

    const filePaths = await electronAPI.selectFiles();
    if (!filePaths?.length) {
      return;
    }

    const capturePaths = filePaths.filter((filePath) => /\.rdc$/i.test(filePath));
    const regularPaths = filePaths.filter((filePath) => !/\.rdc$/i.test(filePath));

    if (capturePaths.length > 0) {
      const importResult = await electronAPI.project.inputs.importPaths(currentProject.projectId, capturePaths);
      if (!importResult.success) {
        showNotice(importResult.error || t('app.importCaptureFailed'));
      } else {
        showNotice(t('app.importCaptureSuccess', { count: capturePaths.length }));
      }
    }

    if (regularPaths.length > 0) {
      setPendingAttachments((current) => {
        const existingByPath = new Set(current.map((entry) => entry.sourcePath));
        const nextEntries = regularPaths
          .filter((filePath) => !existingByPath.has(filePath))
          .map<PendingAttachmentDraft>((filePath) => ({
            id: `draft-${filePath}-${Date.now()}`,
            sourcePath: filePath,
            fileName: filePath.split(/[\\/]/).pop() || filePath,
            mimeType: inferAttachmentMimeType(filePath),
            size: null,
            kind: inferAttachmentKind(filePath),
            isCapture: false,
          }));
        return current.concat(nextEntries);
      });
      showNotice(t('app.stageFilesSuccess', { count: regularPaths.length }));
    }
  }, [currentProject, effectiveLeftCollapsed, leftToggleDisabled, showNotice, t, toggleLeftSidebar]);

  const handlePendingAttachmentRemove = useCallback((attachmentId: string) => {
    setPendingAttachments((current) => current.filter((entry) => entry.id !== attachmentId));
  }, []);

  const handlePromptSend = useCallback(async () => {
    const trimmed = promptValue.trim();
    if ((!trimmed && pendingAttachments.length === 0) || isComposerBusy) {
      return;
    }

    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    if (currentMode !== 'ask' && !hasOpenedCaptureForCurrentProject) {
      showNotice(openCaptureRequiredLabel);
      setCurrentMode('ask');
      return;
    }

    setIsPromptSending(true);
    try {
      const result = await electronAPI.conversation.sendMessage({
        projectId: currentProject?.projectId ?? null,
        sessionId: currentSession?.sessionId ?? null,
        currentRunId: currentRun?.runId ?? null,
        replayDeviceId: selectedDeviceEntry?.id ?? null,
        mode: currentMode,
        message: trimmed,
        attachments: pendingAttachments.map<ConversationAttachmentInput>((attachment) => ({
          sourcePath: attachment.sourcePath,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          size: attachment.size,
        })),
      });

      setPromptValue('');
      setPendingAttachments([]);

      if (result.session?.projectId && currentProject?.projectId !== result.session.projectId) {
        const projectsResult = await electronAPI.project.list();
        const nextProjects = projectsResult.projects ?? [];
        useSessionStore.getState().setProjects(nextProjects);
        const matchedProject = nextProjects.find((project) => project.projectId === result.session?.projectId) ?? null;
        useSessionStore.getState().setCurrentProject(matchedProject);
      }

      if (result.session?.sessionId) {
        setCurrentSession(result.session);
        const sessionsResult = await electronAPI.session.list(result.session.projectId);
        setSessions(sessionsResult.sessions ?? []);
      }

      upsertConversationMessages([
        result.userMessage,
        result.assistantDraftMessage,
      ]);

      if (result.runUpdate) {
        setCurrentRun(result.runUpdate);
        const runsResult = await electronAPI.run.list(result.runUpdate.sessionId);
        setRuns(runsResult.runs ?? []);
      }

      setCurrentDebugPlan(result.debugPlanSummary ?? null);
      setPendingQuestions(result.pendingQuestions ?? null);
    } catch (error) {
      const currentMessages = useSessionStore.getState().conversationMessages ?? [];
      const turnId = `local-turn-${Date.now()}`;
      setConversationMessages(currentMessages.concat([
        {
          id: `local-user-${Date.now()}`,
          turnId,
          sessionId: currentSession?.sessionId ?? null,
          projectId: currentProject?.projectId ?? null,
          runId: currentRun?.runId ?? null,
          modeContext: currentMode,
          role: 'user',
          content: trimmed,
          status: 'complete',
          updatedAt: Date.now(),
          reasoningTrace: null,
          attachments: pendingAttachments.map((attachment) => ({
            attachmentId: `local-${attachment.id}`,
            sessionId: currentSession?.sessionId ?? '',
            projectId: currentProject?.projectId ?? '',
            kind: attachment.kind,
            fileName: attachment.fileName,
            filePath: attachment.sourcePath,
            mimeType: attachment.mimeType || 'application/octet-stream',
            size: attachment.size || 0,
            createdAt: Date.now(),
          })),
          createdAt: Date.now(),
        },
        {
          id: `local-assistant-${Date.now()}`,
          turnId,
          sessionId: currentSession?.sessionId ?? null,
          projectId: currentProject?.projectId ?? null,
          runId: currentRun?.runId ?? null,
          modeContext: currentMode,
          role: 'assistant',
          agentId: 'rdc-debugger',
          content: error instanceof Error ? error.message : t('app.conversationRequestFailed'),
          status: 'error',
          updatedAt: Date.now(),
          reasoningTrace: {
            status: 'error',
            summary: t('app.conversationRequestFailed'),
            steps: [],
            updatedAt: Date.now(),
          },
          createdAt: Date.now(),
        },
      ]));
    } finally {
      setIsPromptSending(false);
    }
  }, [
    currentProject,
    currentMode,
    currentRun,
    currentSession,
    hasOpenedCaptureForCurrentProject,
    isComposerBusy,
    openCaptureRequiredLabel,
    pendingAttachments,
    promptValue,
    selectedDeviceEntry,
    setConversationMessages,
    setCurrentDebugPlan,
    setCurrentMode,
    setCurrentRun,
    setCurrentSession,
    setPendingQuestions,
    setRuns,
    setSessions,
    showNotice,
    t,
    upsertConversationMessages,
  ]);

  const handlePromptKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
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

  const renderMainPage = () => <DebuggerPage mode={currentMode} />;

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loading-logo">RD</div>
        <div className="loading-text">{t('app.loadingShell')}</div>
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
          <button
            type="button"
            className="shell-panel-toggle titlebar-panel-toggle"
            data-testid="titlebar-left-panel-toggle"
            onClick={!leftToggleDisabled ? () => void toggleLeftSidebar() : undefined}
            aria-label={leftPanelToggleLabel}
            title={leftToggleDisabled ? autoCollapsedTitle : leftPanelToggleLabel}
            disabled={leftToggleDisabled}
          >
            <span className="shell-panel-toggle-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {effectiveLeftCollapsed ? (
                  <polyline points="9 18 15 12 9 6" />
                ) : (
                  <polyline points="15 6 9 12 15 18" />
                )}
              </svg>
            </span>
          </button>
        </div>
        <div className="app-titlebar-right no-drag">
          {isRightRailVisible && (
            <button
              type="button"
              className="shell-panel-toggle titlebar-panel-toggle"
              data-testid="titlebar-right-panel-toggle"
              onClick={!rightToggleDisabled ? () => void toggleRightPanel() : undefined}
              aria-label={rightPanelToggleLabel}
              title={rightToggleDisabled ? autoCollapsedTitle : rightPanelToggleLabel}
              disabled={rightToggleDisabled}
            >
              <span className="shell-panel-toggle-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  {effectiveRightCollapsed ? (
                    <polyline points="15 18 9 12 15 6" />
                  ) : (
                    <polyline points="9 18 15 12 9 6" />
                  )}
                </svg>
              </span>
            </button>
          )}
          <div className="window-controls" role="group" aria-label={t('app.windowControls')}>
            <button
              type="button"
              className="window-control window-control-minimize tooltip"
              data-tooltip={t('app.windowMinimize')}
              aria-label={t('app.windowMinimize')}
              onClick={handleWindowMinimize}
            >
              <span className="minimize" />
            </button>
            <button
              type="button"
              className="window-control window-control-maximize tooltip"
              data-tooltip={windowMaximized ? t('app.windowRestore') : t('app.windowMaximize')}
              aria-label={windowMaximized ? t('app.windowRestore') : t('app.windowMaximize')}
              onClick={handleWindowToggleMaximize}
            >
              <span className={windowMaximized ? 'restore' : 'maximize'} />
            </button>
            <button
              type="button"
              className="window-control close tooltip"
              data-tooltip={t('app.windowClose')}
              aria-label={t('app.windowClose')}
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
            ['--left-resize-handle-width' as string]: `${effectiveLeftCollapsed ? 0 : APP_RESIZE_HANDLE_WIDTH}px`,
            ['--right-resize-handle-width' as string]: `${!isRightRailVisible || effectiveRightCollapsed ? 0 : APP_RESIZE_HANDLE_WIDTH}px`,
            ['--workbench-rail-max-width' as string]: workbenchRailMaxWidth,
            ['--workbench-content-rail-width' as string]: workbenchContentRailWidth,
            ['--workbench-inline-mode' as string]: bothSidebarsCollapsed ? 'dual-collapsed' : 'sidebar-open',
          }}
        >
          <aside
            className={`app-sidebar-left ${effectiveLeftCollapsed ? 'collapsed' : ''}`}
            data-testid="app-sidebar-left"
          >
            <nav className="sidebar-nav">
              <Sidebar collapsed={effectiveLeftCollapsed} />
            </nav>
            {!effectiveLeftCollapsed && (
              <div
                className="app-sidebar-footer"
                data-testid="sidebar-footer"
              >
                <button
                  type="button"
                  className="footer-entry footer-user-trigger sidebar-user-trigger sidebar-footer-entry"
                  data-testid="sidebar-user-settings-trigger"
                  onClick={handleUserMenuOpen}
                  title={t('sidebar.userSettings')}
                  aria-label={t('sidebar.userSettings')}
                >
                  <span className="footer-entry-main">
                    <ProfileAvatar
                      className="footer-entry-avatar"
                      avatarPath={avatarPath}
                      nickname={nickname}
                    />
                    <span className="footer-entry-copy">
                      <span className="footer-entry-title">{nickname}</span>
                      <span className="footer-entry-subtitle">{t('sidebar.userSubtitle')}</span>
                    </span>
                  </span>
                  <span className="footer-entry-trailing">
                    <span className="footer-entry-chevron">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="6 9 12 15 18 9" />
                      </svg>
                    </span>
                  </span>
                </button>
              </div>
            )}
          </aside>

          <div
            className={`panel-resize-handle panel-resize-handle-left ${effectiveLeftCollapsed ? 'disabled' : ''}`}
            onPointerDown={!effectiveLeftCollapsed ? startDragging('left', resolvedWidths.left) : undefined}
            aria-hidden="true"
          />

          <main className={`app-main ${isTerminalOpen ? 'terminal-open' : ''}`}>
            <div className="main-content">
              {shellNotice && (
                <div className="shell-notice" role="status" aria-live="polite">
                  {shellNotice}
                </div>
              )}
              <div className="main-floating-utilities">
                <DeviceSelector variant="utility" />
                <button
                  type="button"
                  className={`main-utility-toggle terminal-pill ${isTerminalOpen ? 'active' : ''} ${activityAlertSeverity ? `terminal-${activityAlertSeverity}` : ''}`}
                  onClick={() => toggleTerminalOpen()}
                  data-testid="terminal-toggle"
                  aria-label={isTerminalOpen ? t('terminal.close') : t('terminal.open')}
                  title={isTerminalOpen ? t('terminal.close') : t('terminal.open')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 17l6-6-6-6" />
                    <path d="M12 19h8" />
                  </svg>
                  {activityAlertSeverity && (
                    <span
                      className={`terminal-status-badge ${activityAlertSeverity}`}
                      aria-hidden="true"
                    />
                  )}
                </button>
              </div>
              <div className="main-page-shell">
                {renderMainPage()}
              </div>
            </div>
            {showMainPromptBar && (
              <div className="main-input-bar">
                <PlanIntakePanel />
                <div
                  className="composer-shell"
                  style={{ ['--composer-mode-accent' as string]: currentModeConfig.accentColor }}
                >
                  {pendingAttachments.length > 0 && (
                    <div className="composer-attachments" data-testid="composer-attachments">
                      {pendingAttachments.map((attachment) => (
                        <div key={attachment.id} className={`composer-attachment-chip ${attachment.kind}`}>
                          <span className="composer-attachment-chip-icon" aria-hidden="true">
                            {attachment.kind === 'image' ? 'IMG' : 'FILE'}
                          </span>
                          <span className="composer-attachment-chip-copy">
                            <span className="composer-attachment-chip-name">{attachment.fileName}</span>
                            <span className="composer-attachment-chip-meta">{formatBytes(attachment.size)}</span>
                          </span>
                          <button
                            type="button"
                            className="composer-attachment-chip-remove"
                            onClick={() => handlePendingAttachmentRemove(attachment.id)}
                            aria-label={t('app.removeAttachment', { fileName: attachment.fileName })}
                          >
                            x
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="composer-input-row">
                    <textarea
                      ref={promptInputRef}
                      className="chat-input composer-textarea"
                      name="debuggerPrompt"
                      value={promptValue}
                      onChange={(event) => setPromptValue(event.target.value)}
                      onKeyDown={handlePromptKeyDown}
                      placeholder={promptPlaceholder}
                      aria-label={promptPlaceholder}
                      rows={1}
                    />
                  </div>
                  <div className="composer-footer-bar" data-testid="composer-footer-bar">
                    <div className="composer-toolbar-group composer-toolbar-group-left">
                      <button
                        type="button"
                        className="composer-attach-button"
                        data-testid="composer-attach-button"
                        onClick={() => void handleAttachmentSelect()}
                        disabled={isComposerBusy}
                        title={attachButtonLabel}
                        aria-label={attachButtonLabel}
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 5v14" />
                          <path d="M5 12h14" />
                        </svg>
                      </button>
                      <div ref={modeMenuRef} className="composer-agent-menu">
                        <button
                          type="button"
                          className={`composer-agent-pill ${modeMenuOpen ? 'open' : ''}`}
                          data-testid="composer-mode-pill"
                          onClick={() => setModeMenuOpen((current) => !current)}
                          aria-haspopup="menu"
                          aria-expanded={modeMenuOpen}
                        >
                          <span className="composer-agent-pill-icon" aria-hidden="true">
                            <ModeGlyph mode={currentMode} size={15} strokeWidth={1.9} />
                          </span>
                          <span className="composer-agent-pill-label">{currentModeLabel}</span>
                          <span className="composer-agent-pill-caret" aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="6 9 12 15 18 9" />
                            </svg>
                          </span>
                        </button>
                        {modeMenuOpen && (
                          <div className="composer-agent-menu-popup" role="menu">
                            {AGENT_MODES.map((mode) => {
                              const executionModeDisabled = mode.id !== 'ask' && !hasOpenedCaptureForCurrentProject;
                              return (
                                <button
                                  key={mode.id}
                                  type="button"
                                  className={`composer-agent-menu-item ${currentMode === mode.id ? 'active' : ''} ${executionModeDisabled ? 'disabled' : ''}`}
                                  data-testid={`mode-menu-item-${mode.id}`}
                                  role="menuitemradio"
                                  aria-checked={currentMode === mode.id}
                                  aria-disabled={executionModeDisabled}
                                  disabled={executionModeDisabled}
                                  title={executionModeDisabled ? openCaptureRequiredLabel : mode.description}
                                  onClick={() => {
                                    if (executionModeDisabled) {
                                      return;
                                    }
                                    setCurrentMode(mode.id);
                                    setModeMenuOpen(false);
                                  }}
                                >
                                  <span className="composer-agent-menu-item-copy">
                                    <span className="composer-agent-menu-item-icon" aria-hidden="true">
                                      <ModeGlyph mode={mode.id} size={15} strokeWidth={1.9} />
                                    </span>
                                    <span className="composer-agent-menu-item-label">{modeLabels[mode.id]}</span>
                                    {executionModeDisabled ? (
                                      <span className="composer-agent-menu-item-hint">{openCaptureRequiredLabel}</span>
                                    ) : null}
                                  </span>
                                  {currentMode === mode.id ? <span className="composer-agent-menu-item-check">●</span> : null}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="composer-toolbar-group composer-toolbar-group-right">
                      <ContextUsageIndicator usage={hasActiveDebugRun ? currentRunUsage : null} language={language} />
                      <button
                        type="button"
                        className={`chat-send-button primary ${isComposerBusy ? 'is-stop' : ''}`}
                        data-testid={isComposerBusy ? 'debugger-stop-button' : 'debugger-start-button'}
                        onClick={() => void (isComposerBusy ? handlePrimaryStop() : handlePromptSend())}
                        disabled={primaryButtonDisabled}
                        aria-label={primaryButtonDescription}
                        title={primaryButtonDescription}
                      >
                        {isComposerBusy ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                            <rect x="6" y="6" width="12" height="12" rx="1" />
                          </svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="22" y1="2" x2="11" y2="13" />
                            <polygon points="22 2 15 22 11 13 2 9 22 2" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <TerminalDrawer />
          </main>

          {isRightRailVisible && (
            <>
              <div
                className={`panel-resize-handle panel-resize-handle-right ${effectiveRightCollapsed ? 'disabled' : ''}`}
                onPointerDown={!effectiveRightCollapsed ? startDragging('right', resolvedWidths.right) : undefined}
                aria-hidden="true"
              />

              <aside
                className={`app-sidebar-right ${effectiveRightCollapsed ? 'collapsed' : ''}`}
                data-testid="app-sidebar-right"
              >
                <div
                  className={`right-panel-body ${effectiveRightCollapsed ? 'collapsed' : ''}`}
                  data-testid="control-panel-scroll"
                >
                  <ControlPanel />
                </div>
              </aside>
            </>
          )}
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
