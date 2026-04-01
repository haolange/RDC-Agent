import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DebuggerPage } from './pages/Debugger';
import { AnalyzerPage } from './pages/Analyzer';
import { OptimizerPage } from './pages/Optimizer';

type TabId = 'debugger' | 'analyzer' | 'optimizer';

interface TabConfig {
  id: TabId;
  label: string;
  badge?: string;
  disabled?: boolean;
}

interface DebuggerImportRequest {
  id: number;
  files: string[];
}

interface SessionFooterState {
  contextLabel: string;
  sessionLabel: string;
}

const TABS: TabConfig[] = [
  { id: 'debugger', label: 'Debugger', badge: 'Active' },
  { id: 'analyzer', label: 'Analyzer', disabled: true },
  { id: 'optimizer', label: 'Optimizer', disabled: true },
];

const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('debugger');
  const [isLoading, setIsLoading] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'degraded' | 'offline'>('offline');
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [llmProvider, setLlmProvider] = useState('OpenRouter');
  const [windowMaximized, setWindowMaximized] = useState(false);
  const [shellNotice, setShellNotice] = useState<string | null>(null);
  const [debuggerImportRequest, setDebuggerImportRequest] = useState<DebuggerImportRequest | null>(null);
  const [debuggerPickerSignal, setDebuggerPickerSignal] = useState(0);
  const [debuggerResetSignal, setDebuggerResetSignal] = useState(0);
  const [footerState, setFooterState] = useState<SessionFooterState>({
    contextLabel: '--',
    sessionLabel: '--',
  });

  const electronAPI =
    typeof window !== 'undefined'
      ? (window as Window & { electronAPI?: Window['electronAPI'] }).electronAPI
      : undefined;

  const showNotice = useCallback((message: string) => {
    setShellNotice(message);
  }, []);

  useEffect(() => {
    if (!shellNotice) return;

    const timeoutId = window.setTimeout(() => {
      setShellNotice(null);
    }, 3200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [shellNotice]);

  useEffect(() => {
    const initApp = async () => {
      try {
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

    initApp();
  }, [electronAPI]);

  useEffect(() => {
    if (!electronAPI) return;

    const handleFileOpen = (paths: unknown) => {
      if (!Array.isArray(paths) || paths.length === 0) return;
      setActiveTab('debugger');
      setDebuggerImportRequest({
        id: Date.now(),
        files: paths.filter((path): path is string => typeof path === 'string'),
      });
    };

    const handleCaseNew = () => {
      setActiveTab('debugger');
      setDebuggerImportRequest(null);
      setDebuggerResetSignal((value) => value + 1);
      setFooterState({ contextLabel: '--', sessionLabel: '--' });
      showNotice('Started a fresh debug workspace.');
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
    };
  }, [electronAPI, showNotice]);

  const connectionMeta = useMemo(() => {
    if (connectionStatus === 'connected') {
      return { label: 'Connected', dotClass: 'status-dot-info' };
    }

    if (connectionStatus === 'degraded') {
      return { label: 'Degraded', dotClass: 'status-dot-warning' };
    }

    return { label: 'Offline', dotClass: 'status-dot-pending' };
  }, [connectionStatus]);

  const handleOpenCapture = useCallback(() => {
    setActiveTab('debugger');
    setDebuggerPickerSignal((value) => value + 1);
  }, []);

  const handleNewCase = useCallback(() => {
    setActiveTab('debugger');
    setDebuggerImportRequest(null);
    setDebuggerResetSignal((value) => value + 1);
    setFooterState({ contextLabel: '--', sessionLabel: '--' });
  }, []);

  const handleSettings = useCallback(() => {
    showNotice('Settings panel is not implemented yet.');
  }, [showNotice]);

  const handleHelp = useCallback(() => {
    window.open('https://github.com/rdc-agent/docs');
  }, []);

  const handleWindowMinimize = useCallback(async () => {
    await electronAPI?.windowControls.minimize();
  }, [electronAPI]);

  const handleWindowToggleMaximize = useCallback(async () => {
    if (!electronAPI) return;
    const nextState = await electronAPI.windowControls.toggleMaximize();
    setWindowMaximized(nextState);
  }, [electronAPI]);

  const handleWindowClose = useCallback(async () => {
    await electronAPI?.windowControls.close();
  }, [electronAPI]);

  const handleDebuggerSessionChange = useCallback((nextState: SessionFooterState) => {
    setFooterState(nextState);
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'debugger':
        return (
          <DebuggerPage
            importRequest={debuggerImportRequest}
            openPickerSignal={debuggerPickerSignal}
            resetSignal={debuggerResetSignal}
            onSessionStateChange={handleDebuggerSessionChange}
            onError={showNotice}
          />
        );
      case 'analyzer':
        return <AnalyzerPage />;
      case 'optimizer':
        return <OptimizerPage />;
      default:
        return null;
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
      <header className="app-header">
        <div className="app-brand">
          <div className="app-logo">
            <div className="app-logo-icon">RD</div>
            <div className="app-logo-copy">
              <span className="app-logo-text">RDC Agent</span>
              <span className="app-logo-subtitle">RenderDoc Debug Agent</span>
            </div>
          </div>
        </div>

        <nav className="tab-nav">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`tab-button ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => !tab.disabled && setActiveTab(tab.id)}
              disabled={tab.disabled}
            >
              {tab.label}
              {tab.badge && <span className="tab-badge">{tab.badge}</span>}
            </button>
          ))}
        </nav>

        <div className="header-right">
          <div className="header-actions">
            <button className="button button-secondary button-sm" onClick={handleOpenCapture}>
              Open Capture
            </button>
            <button className="button button-ghost button-sm" onClick={handleNewCase}>
              New Case
            </button>
            <button className="icon-button tooltip" data-tooltip="Settings" onClick={handleSettings}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
            <button className="icon-button tooltip" data-tooltip="Help" onClick={handleHelp}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </button>
          </div>

          <div className="window-controls">
            <button className="window-control tooltip" data-tooltip="Minimize" onClick={handleWindowMinimize}>
              <span />
            </button>
            <button
              className="window-control tooltip"
              data-tooltip={windowMaximized ? 'Restore' : 'Maximize'}
              onClick={handleWindowToggleMaximize}
            >
              <span className={windowMaximized ? 'restore' : 'maximize'} />
            </button>
            <button className="window-control close tooltip" data-tooltip="Close" onClick={handleWindowClose}>
              <span className="close-mark" />
            </button>
          </div>
        </div>
      </header>

      <main className="app-content">
        {shellNotice && <div className="shell-notice">{shellNotice}</div>}
        {renderContent()}
      </main>

      <footer className="app-footer">
        <div className="footer-left">
          <div className="footer-item">
            <span className={`status-dot ${connectionMeta.dotClass}`} />
            <span>{connectionMeta.label}</span>
          </div>
          <div className="footer-separator" />
          <div className="footer-item">
            <span>Context: {footerState.contextLabel}</span>
          </div>
          <div className="footer-item">
            <span>Session: {footerState.sessionLabel}</span>
          </div>
        </div>

        <div className="footer-right">
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
