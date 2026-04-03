import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DebuggerPage } from './pages/Debugger';
import { AnalyzerPage } from './pages/Analyzer';
import { OptimizerPage } from './pages/Optimizer';
import { ControlPanel } from './components/ControlPanel';
import { ModeSelector } from './components/ModeSelector';
import { DeviceSelector } from './components/DeviceSelector';
import { Sidebar } from './components/Sidebar';
import { useLayoutStore } from './stores/layoutStore';
import { useSessionStore } from './stores/sessionStore';
import { useDeviceStore } from './stores/deviceStore';
import type { AgentTimelineEntry } from '@shared/types/agent';
import type { ToolTraceEntry } from '@shared/types/tool';
import type { ReplayDeviceStatusChangedPayload } from '@shared/types/device';

const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'degraded' | 'offline'>('offline');
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [llmProvider, setLlmProvider] = useState('OpenRouter');
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [shellNotice, setShellNotice] = useState<string | null>(null);

  const currentMode = useLayoutStore((s) => s.currentMode);

  const showNotice = useCallback((message: string) => {
    setShellNotice(message);
  }, []);

  useEffect(() => {
    if (!shellNotice) return;
    const timeoutId = window.setTimeout(() => setShellNotice(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [shellNotice]);

  useEffect(() => {
    const initApp = async () => {
      try {
        const electronAPI = window.electronAPI;
        if (electronAPI) {
          const [settings, appMeta, isMaximized] = await Promise.all([
            electronAPI.settings.get(),
            electronAPI.appMeta.get(),
            electronAPI.windowControls.isMaximized(),
          ]);
          setLlmProvider(settings.llm.defaultProvider || 'OpenRouter');
          setAppVersion(appMeta.version || '1.0.0');
          setWindowMaximized(isMaximized);
          setConnectionStatus('connected');
        } else {
          setConnectionStatus('offline');
        }
      } catch (error) {
        console.error('Failed to initialize app shell:', error);
        setConnectionStatus('degraded');
      } finally {
        window.setTimeout(() => setIsLoading(false), 320);
      }
    };

    void initApp();
  }, []);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) return;

    electronAPI.events.onContextChanged((snapshot) => {
      useSessionStore.getState().setContextSnapshot(snapshot);
      useSessionStore.getState().setCaptures(snapshot.captureDescriptors ?? []);
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
        useSessionStore.getState().setCaptures(snapshot.captureDescriptors ?? []);
      }).catch(() => undefined);
    });

    electronAPI.events.onWorkflowStateChanged(() => {
      electronAPI.workflow.listRuns().then((result) => {
        useSessionStore.getState().setRecentRuns(result.runs ?? []);
      }).catch(() => undefined);
    });

    electronAPI.events.onDeviceStatusChanged((payload) => {
      useDeviceStore.getState().applyStatusPayload(payload as ReplayDeviceStatusChangedPayload);
    });

    electronAPI.workflow.listRuns()
      .then((result) => {
        useSessionStore.getState().setRecentRuns(result.runs ?? []);
      })
      .catch(() => undefined);

    void useDeviceStore.getState().loadDevices();

    const handleFileOpen = (paths: unknown) => {
      if (!Array.isArray(paths) || paths.length === 0) return;
      showNotice(`已接收 ${paths.length} 个文件，请在 Debugger 页面确认。`);
    };
    const handleCaseNew = () => {
      useSessionStore.getState().reset();
      showNotice('已创建新的调试工作区。');
    };
    const handleSettingsOpen = () => {
      showNotice('Settings panel is not implemented yet.');
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
    };
  }, [showNotice]);

  const connectionMeta = useMemo(() => {
    if (connectionStatus === 'connected') return { label: 'Connected', dotClass: 'status-dot-info' };
    if (connectionStatus === 'degraded') return { label: 'Degraded', dotClass: 'status-dot-warning' };
    return { label: 'Offline', dotClass: 'status-dot-pending' };
  }, [connectionStatus]);

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

  const getSessionTitle = () => {
    switch (currentMode) {
      case 'analyzer': return 'Analyzer Session';
      case 'optimizer': return 'Optimizer Session';
      default: return 'Debug Session';
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
        <div className="app-titlebar-center">
          <span className="app-titlebar-session">{getSessionTitle()}</span>
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

      <div className="app-body">
        <aside className="app-sidebar-left">
          <nav className="sidebar-nav">
            <Sidebar />
          </nav>
        </aside>

        <main className="app-main">
          <div className="main-header">
            <div className="main-title">
              <span className="session-title">{getSessionTitle()}</span>
            </div>
          </div>
          <div className="main-content">
            {shellNotice && <div className="shell-notice">{shellNotice}</div>}
            {renderMainPage()}
          </div>
          <div className="main-input-bar">
            <ModeSelector />
            <div className="chat-input-wrapper">
              <input
                type="text"
                className="chat-input"
                placeholder="描述任务，调用技能与工具"
              />
              <button className="send-button">→</button>
            </div>
          </div>
        </main>

        <aside className="app-sidebar-right">
          <ControlPanel />
        </aside>
      </div>

      <footer className="app-footer">
        <div className="footer-left">
          <DeviceSelector />
          <div className="footer-separator" />
        </div>
        <div className="footer-right">
          <div className="footer-item">
            <span className={`status-dot ${connectionMeta.dotClass}`} />
            <span>{connectionMeta.label}</span>
          </div>
          <div className="footer-separator" />
          <div className="footer-item">
            <span>LLM: {llmProvider}</span>
          </div>
          <div className="footer-separator" />
          <div className="footer-item">
            <span>v{appVersion}</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default App;

