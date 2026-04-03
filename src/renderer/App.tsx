import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DebuggerPage } from './pages/Debugger';
import { AnalyzerPage } from './pages/Analyzer';
import { OptimizerPage } from './pages/Optimizer';
import { ControlPanel } from './components/ControlPanel';
import { ModeSelector } from './components/ModeSelector';
import { DeviceSelector } from './components/DeviceSelector';
import { Sidebar } from './components/Sidebar';
import { UserMenu } from './components/UserMenu';
import { SettingsModal } from './components/SettingsModal';
import { useLayoutStore } from './stores/layoutStore';
import { useSessionStore } from './stores/sessionStore';
import { useDeviceStore } from './stores/deviceStore';
import { useAppSettingsStore } from './stores/appSettingsStore';
import { useI18n } from './i18n';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type { ToolTraceEntry } from '@shared/types/tool';
import type { ReplayDeviceStatusChangedPayload } from '@shared/types/device';
import type { ResolvedTheme } from '@shared/types/settings';
import type { DebugSessionStartRequest } from '@shared/types/session';
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

const resolveSidebarWidths = (
  containerWidth: number,
  leftWidth: number,
  rightWidth: number,
  leftCollapsed: boolean,
  rightCollapsed: boolean,
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
  const availableSidebarSpace = Math.max(0, containerWidth - APP_MIN_MAIN_WIDTH - APP_RESIZE_HANDLE_WIDTH * 2);
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

const App: React.FC = () => {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'degraded' | 'offline'>('offline');
  const [appVersion, setAppVersion] = useState('1.0.0');
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

  const currentMode = useLayoutStore((state) => state.currentMode);
  const currentProject = useSessionStore((state) => state.currentProject);
  const currentSession = useSessionStore((state) => state.currentSession);
  const currentRun = useSessionStore((state) => state.currentRun);
  const captures = useSessionStore((state) => state.captures);
  const leftSidebarCollapsed = useLayoutStore((state) => state.leftSidebarCollapsed);
  const rightPanelCollapsed = useLayoutStore((state) => state.rightPanelCollapsed);
  const leftSidebarWidth = useLayoutStore((state) => state.leftSidebarWidth);
  const rightPanelWidth = useLayoutStore((state) => state.rightPanelWidth);
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
  const isDebuggerMode = currentMode === 'debugger';
  const showWorkbenchShell = isDebuggerMode;

  const showNotice = useCallback((message: string) => {
    setShellNotice(message);
  }, []);

  const setCurrentRun = useSessionStore((state) => state.setCurrentRun);
  const setSessions = useSessionStore((state) => state.setSessions);
  const setCurrentSession = useSessionStore((state) => state.setCurrentSession);
  const setRuns = useSessionStore((state) => state.setRuns);
  const setContextSnapshot = useSessionStore((state) => state.setContextSnapshot);
  const setCaptures = useSessionStore((state) => state.setCaptures);
  const addTimelineEntry = useSessionStore((state) => state.addTimelineEntry);

  useEffect(() => {
    if (!shellNotice) return;
    const timeoutId = window.setTimeout(() => setShellNotice(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [shellNotice]);

  useEffect(() => {
    if (!showWorkbenchShell) return;
    const node = appBodyRef.current;
    if (!node) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setAppBodyWidth(entry.contentRect.width);
      }
    });

    observer.observe(node);
    setAppBodyWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
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
        setAppVersion(appMeta.version || '1.0.0');
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

    electronAPI.events.onContextChanged((snapshot) => {
      useSessionStore.getState().setContextSnapshot(snapshot);
      if (useSessionStore.getState().currentRun && snapshot.captureDescriptors?.length) {
        useSessionStore.getState().setCaptures(snapshot.captureDescriptors ?? []);
      }
    });

    electronAPI.events.onToolExecutionComplete((rawTrace) => {
      const trace = rawTrace as ToolTraceEntry;
      const entry: AgentTimelineEntry = {
        id: trace.traceId,
        type: 'tool_call',
        content: trace.toolName,
        toolTrace: trace,
        timestamp: trace.timestamp,
      };
      useSessionStore.getState().addTimelineEntry(entry);
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
        if (useSessionStore.getState().currentRun && snapshot.captureDescriptors?.length) {
          useSessionStore.getState().setCaptures(snapshot.captureDescriptors ?? []);
        }
      }).catch(() => undefined);
    });

    electronAPI.events.onWorkflowStateChanged(() => {
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
      electronAPI.events.removeAllListeners('device:statusChanged');
      electronAPI.events.removeAllListeners('app:themeChanged');
      electronAPI.events.removeAllListeners('project:inputsChanged');
      electronAPI.events.removeAllListeners('capture:openedStateChanged');
    };
  }, [setSystemTheme, showNotice, t]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!currentProject) {
      useSessionStore.getState().setProjectInputs([]);
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
    const handlePointerMove = (event: PointerEvent) => {
      const dragState = dragStateRef.current;
      if (!dragState || !appBodyRef.current) return;

      const containerWidth = appBodyRef.current.getBoundingClientRect().width;
      const { left: resolvedLeft, right: resolvedRight } = resolveSidebarWidths(
        containerWidth,
        leftSidebarWidth,
        rightPanelWidth,
        leftSidebarCollapsed,
        rightPanelCollapsed,
      );

      if (dragState.side === 'left' && !leftSidebarCollapsed) {
        const maxByMain = Math.max(
          LEFT_SIDEBAR_MIN_WIDTH,
          Math.min(
            LEFT_SIDEBAR_MAX_WIDTH,
            containerWidth - APP_MIN_MAIN_WIDTH - APP_RESIZE_HANDLE_WIDTH * 2 - resolvedRight,
          ),
        );
        setLeftSidebarWidth(Math.min(maxByMain, dragState.startWidth + (event.clientX - dragState.startX)));
      }

      if (dragState.side === 'right' && !rightPanelCollapsed) {
        const maxByMain = Math.max(
          RIGHT_PANEL_MIN_WIDTH,
          Math.min(
            RIGHT_PANEL_MAX_WIDTH,
            containerWidth - APP_MIN_MAIN_WIDTH - APP_RESIZE_HANDLE_WIDTH * 2 - resolvedLeft,
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
    leftSidebarCollapsed,
    leftSidebarWidth,
    persistLayout,
    rightPanelCollapsed,
    rightPanelWidth,
    setLeftSidebarWidth,
    setRightPanelWidth,
  ]);

  const connectionMeta = useMemo(() => {
    if (connectionStatus === 'connected') return { label: t('app.connected'), dotClass: 'status-dot-info' };
    if (connectionStatus === 'degraded') return { label: t('app.degraded'), dotClass: 'status-dot-warning' };
    return { label: t('app.offline'), dotClass: 'status-dot-pending' };
  }, [connectionStatus, t]);

  const debuggerRoute = settings.llm.agentRoutes.find((route) => route.agentId === 'rdc-debugger');
  const llmProviderLabel = settings.llm.providers.find((provider) => provider.id === debuggerRoute?.providerId)?.label
    ?? debuggerRoute?.providerId
    ?? 'LLM';
  const devices = useDeviceStore((state) => state.devices);
  const selectedDevice = useDeviceStore((state) => state.selectedDevice);
  const selectedDeviceEntry = devices.find((device) => device.id === selectedDevice);
  const primaryCapture = captures.find((descriptor) => descriptor.role === 'primary') ?? null;
  const hasRemoteCapture = captures.some((descriptor) => descriptor.backendHint === 'remote');
  const remoteDeviceReady = Boolean(
    selectedDeviceEntry
      && selectedDeviceEntry.type === 'android'
      && ['connected', 'online'].includes(selectedDeviceEntry.status),
  );
  const remoteReplayBlocked = hasRemoteCapture && !remoteDeviceReady;
  const showMainPromptBar = currentMode !== 'debugger' || !currentRun;

  const resolvedWidths = useMemo(
    () => resolveSidebarWidths(
      appBodyWidth,
      leftSidebarWidth,
      rightPanelWidth,
      leftSidebarCollapsed,
      rightPanelCollapsed,
    ),
    [appBodyWidth, leftSidebarCollapsed, leftSidebarWidth, rightPanelCollapsed, rightPanelWidth],
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

  const handlePromptSend = useCallback(async () => {
    const trimmed = promptValue.trim();
    if (!trimmed || isPromptSending) return;

    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    if (currentMode === 'debugger' && !currentRun) {
      if (!currentProject) {
        showNotice('请先添加并选择一个项目。');
        return;
      }

      if (!selectedDeviceEntry) {
        showNotice('请先选择 Replay Device。');
        return;
      }

      if (captures.length === 0) {
        showNotice('请先从右侧导入至少一个 capture。');
        return;
      }

      if (!primaryCapture) {
        showNotice('请先为当前 session 设置 Primary capture。');
        return;
      }

      if (remoteReplayBlocked) {
        showNotice('当前远端 Replay Device 还未就绪。');
        return;
      }

      setIsPromptSending(true);
      try {
        const request: DebugSessionStartRequest = {
          projectId: currentProject.projectId,
          sessionId: currentSession?.sessionId,
          mode: 'debugger',
          goal: trimmed,
          captures,
          primaryCaptureId: primaryCapture.id,
          replayDevice: selectedDeviceEntry,
        };

        const result = await electronAPI.workflow.start(request);
        if (!result.success) {
          showNotice(result.error || 'Failed to start debug session.');
          return;
        }

        if (result.contextSnapshot) {
          setContextSnapshot(result.contextSnapshot);
          setCaptures(result.contextSnapshot.captureDescriptors ?? captures);
        }

        setCurrentRun({
          runId: result.runId ?? `run-${Date.now()}`,
          projectId: currentProject.projectId,
          caseId: result.caseId ?? '',
          sessionId: result.sessionId ?? '',
          mode: 'debugger',
          goal: trimmed,
          captures,
          startedAt: Date.now(),
          status: 'running',
          lastStage: 'preflight_pending',
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

    if (currentMode === 'debugger' && currentRun) {
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

    showNotice('当前模式暂未接入 prompt 工作流。');
  }, [
    addTimelineEntry,
    captures,
    currentMode,
    currentProject,
    currentRun,
    currentSession,
    isPromptSending,
    primaryCapture,
    promptValue,
    remoteReplayBlocked,
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

  const renderMainPage = () => {
    switch (currentMode) {
      case 'analyzer':
        return <AnalyzerPage />;
      case 'optimizer':
        return <OptimizerPage />;
      case 'debugger':
      default:
        return <DebuggerPage />;
    }
  };

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
          <ModeSelector />
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

      {showWorkbenchShell && (
        <div
          ref={appBodyRef}
          className={`app-body ${isResizing ? 'is-resizing' : ''}`}
          style={{
            ['--left-sidebar-width' as string]: `${resolvedWidths.left}px`,
            ['--right-panel-width' as string]: `${resolvedWidths.right}px`,
            ['--resize-handle-width' as string]: `${APP_RESIZE_HANDLE_WIDTH}px`,
          }}
        >
          <aside className={`app-sidebar-left ${leftSidebarCollapsed ? 'collapsed' : ''}`}>
            <div className="shell-panel-header shell-panel-header-left">
              <button
                type="button"
                className="shell-panel-toggle"
                onClick={() => void toggleLeftSidebar()}
                aria-label={leftSidebarCollapsed ? 'Expand left sidebar' : 'Collapse left sidebar'}
                title={leftSidebarCollapsed ? '展开左侧栏' : '收起左侧栏'}
              >
                <span className="shell-panel-toggle-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {leftSidebarCollapsed ? (
                      <polyline points="9 18 15 12 9 6" />
                    ) : (
                      <polyline points="15 18 9 12 15 6" />
                    )}
                  </svg>
                </span>
              </button>
            </div>
            <nav className="sidebar-nav">
              <Sidebar collapsed={leftSidebarCollapsed} />
            </nav>
          </aside>

          <div
            className={`panel-resize-handle ${leftSidebarCollapsed ? 'disabled' : ''}`}
            onPointerDown={!leftSidebarCollapsed ? startDragging('left', resolvedWidths.left) : undefined}
            aria-hidden="true"
          />

          <main className="app-main">
            <div className="main-content">
              {shellNotice && <div className="shell-notice">{shellNotice}</div>}
              {renderMainPage()}
            </div>
            {showMainPromptBar && (
              <div className="main-input-bar">
                <div className="chat-input-wrapper">
                  <input
                    type="text"
                    className="chat-input"
                    value={promptValue}
                    onChange={(event) => setPromptValue(event.target.value)}
                    onKeyDown={handlePromptKeyDown}
                    placeholder={t('app.inputPlaceholder')}
                  />
                  <button className="send-button" onClick={() => void handlePromptSend()} disabled={!promptValue.trim() || isPromptSending}>
                    →
                  </button>
                </div>
              </div>
            )}
          </main>

          <div
            className={`panel-resize-handle ${rightPanelCollapsed ? 'disabled' : ''}`}
            onPointerDown={!rightPanelCollapsed ? startDragging('right', resolvedWidths.right) : undefined}
            aria-hidden="true"
          />

          <aside className={`app-sidebar-right ${rightPanelCollapsed ? 'collapsed' : ''}`}>
            <div className="shell-panel-header shell-panel-header-right">
              <button
                type="button"
                className="shell-panel-toggle"
                onClick={() => void toggleRightPanel()}
                aria-label={rightPanelCollapsed ? 'Expand right panel' : 'Collapse right panel'}
                title={rightPanelCollapsed ? '展开右侧栏' : '收起右侧栏'}
              >
                <span className="shell-panel-toggle-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    {rightPanelCollapsed ? (
                      <polyline points="9 18 15 12 9 6" />
                    ) : (
                      <polyline points="15 18 9 12 15 6" />
                    )}
                  </svg>
                </span>
              </button>
            </div>
            <div className={`right-panel-body ${rightPanelCollapsed ? 'collapsed' : ''}`}>
              <ControlPanel />
            </div>
          </aside>
        </div>
      )}

      {!showWorkbenchShell && (
        <div className="app-body-blank">
          <main className="app-main app-main-blank">
            <div className="main-content">
              {shellNotice && <div className="shell-notice">{shellNotice}</div>}
              {renderMainPage()}
            </div>
            {showMainPromptBar && (
              <div className="main-input-bar">
                <div className="chat-input-wrapper">
                  <input
                    type="text"
                    className="chat-input"
                    value={promptValue}
                    onChange={(event) => setPromptValue(event.target.value)}
                    onKeyDown={handlePromptKeyDown}
                    placeholder={t('app.inputPlaceholder')}
                  />
                  <button className="send-button" onClick={() => void handlePromptSend()} disabled={!promptValue.trim() || isPromptSending}>
                    →
                  </button>
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-left">
          <button
            type="button"
            className="footer-entry footer-user-trigger"
            onClick={handleUserMenuOpen}
            title={t('sidebar.userSettings')}
          >
            <span className="footer-entry-avatar">
              {nickname.trim().slice(0, 2).toUpperCase()}
            </span>
            <span className="footer-entry-copy">
              <span className="footer-entry-title">{nickname}</span>
              <span className="footer-entry-subtitle">{t('sidebar.userSubtitle')}</span>
            </span>
            <span className="footer-entry-chevron">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </span>
          </button>
          <DeviceSelector />
        </div>
        <div className="footer-right">
          <div className="footer-item">
            <span className={`status-dot ${connectionMeta.dotClass}`} />
            <span>{connectionMeta.label}</span>
          </div>
          <div className="footer-separator" />
          <div className="footer-item">
            <span>LLM: {llmProviderLabel}</span>
          </div>
          <div className="footer-separator" />
          <div className="footer-item">
            <span>v{appVersion}</span>
          </div>
        </div>
      </footer>

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
