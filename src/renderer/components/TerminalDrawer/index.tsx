import React, { useEffect, useMemo, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import type { TerminalDataEvent, TerminalExitEvent, TerminalTabRecord } from '@shared/types/terminal';
import { useI18n } from '../../i18n';
import { useSessionStore } from '../../stores/sessionStore';
import { TERMINAL_LOGS_TAB_ID, useTerminalStore } from '../../stores/terminalStore';
import './TerminalDrawer.css';

const formatTimestamp = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const formatRaw = (value: RuntimeLogEntry['raw']): string => {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
};

const formatTabLabel = (tab: TerminalTabRecord): string => {
  const cwd = tab.cwd?.split(/[\\/]/).filter(Boolean).slice(-2).join('\\') || tab.cwd;
  return cwd ? `PowerShell: ${cwd}` : tab.title;
};

export const TerminalDrawer: React.FC = () => {
  const { t } = useI18n();
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const renderedStateRef = useRef<{ tabId: string | null; length: number }>({ tabId: null, length: 0 });
  const activeTabIdRef = useRef<string | null>(null);

  const currentProject = useSessionStore((state) => state.currentProject);

  const isOpen = useTerminalStore((state) => state.isOpen);
  const scope = useTerminalStore((state) => state.scope);
  const namespace = useTerminalStore((state) => state.namespace);
  const detailLevel = useTerminalStore((state) => state.detailLevel);
  const activeSessionId = useTerminalStore((state) => state.activeSessionId);
  const entries = useTerminalStore((state) => state.entries);
  const isLoading = useTerminalStore((state) => state.isLoading);
  const tabs = useTerminalStore((state) => state.tabs);
  const activeTabId = useTerminalStore((state) => state.activeTabId);
  const shellBuffers = useTerminalStore((state) => state.shellBuffers);
  const setScope = useTerminalStore((state) => state.setScope);
  const setNamespace = useTerminalStore((state) => state.setNamespace);
  const setDetailLevel = useTerminalStore((state) => state.setDetailLevel);
  const refreshEntries = useTerminalStore((state) => state.refreshEntries);
  const syncTabs = useTerminalStore((state) => state.syncTabs);
  const refreshTabs = useTerminalStore((state) => state.refreshTabs);
  const ensureShellTab = useTerminalStore((state) => state.ensureShellTab);
  const createShellTab = useTerminalStore((state) => state.createShellTab);
  const activateTab = useTerminalStore((state) => state.activateTab);
  const closeShellTab = useTerminalStore((state) => state.closeShellTab);
  const appendTerminalData = useTerminalStore((state) => state.appendTerminalData);
  const markTerminalExit = useTerminalStore((state) => state.markTerminalExit);

  const filteredEntries = useMemo(() => (
    namespace === 'all'
      ? entries
      : entries.filter((entry) => entry.namespace === namespace)
  ), [entries, namespace]);

  const shellTabs = useMemo(
    () => tabs.filter((tab) => tab.kind === 'shell'),
    [tabs],
  );

  const activeShellTab = useMemo(
    () => shellTabs.find((tab) => tab.tabId === activeTabId) ?? shellTabs[0] ?? null,
    [activeTabId, shellTabs],
  );

  const activeShellBuffer = activeShellTab ? (shellBuffers[activeShellTab.tabId] ?? '') : '';
  const isLogsTab = activeTabId === TERMINAL_LOGS_TAB_ID;
  const emptyCopy = scope === 'session'
    ? (activeSessionId ? t('terminal.emptySession') : t('terminal.emptySessionHint'))
    : t('terminal.emptyApp');

  useEffect(() => {
    activeTabIdRef.current = isLogsTab ? null : activeShellTab?.tabId ?? null;
  }, [activeShellTab?.tabId, isLogsTab]);

  useEffect(() => {
    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      return;
    }

    const handleTerminalData = (payload: unknown) => {
      appendTerminalData(payload as TerminalDataEvent);
    };
    const handleTerminalExit = (payload: unknown) => {
      markTerminalExit(payload as TerminalExitEvent);
    };
    const handleTabsChanged = (payload: unknown) => {
      syncTabs(((payload as { tabs?: TerminalTabRecord[] })?.tabs) ?? []);
    };

    electronAPI.on('terminal:data', handleTerminalData);
    electronAPI.on('terminal:exit', handleTerminalExit);
    electronAPI.on('terminal:tabsChanged', handleTabsChanged);

    return () => {
      electronAPI.off('terminal:data', handleTerminalData);
      electronAPI.off('terminal:exit', handleTerminalExit);
      electronAPI.off('terminal:tabsChanged', handleTabsChanged);
    };
  }, [appendTerminalData, markTerminalExit, syncTabs]);

  useEffect(() => {
    void refreshTabs();
  }, [refreshTabs]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    if (isLogsTab) {
      void refreshEntries();
    }

    if (shellTabs.length === 0) {
      void ensureShellTab(currentProject?.rootPath ?? null);
    }
  }, [
    currentProject?.rootPath,
    ensureShellTab,
    isLogsTab,
    isOpen,
    refreshEntries,
    shellTabs.length,
  ]);

  useEffect(() => {
    if (!isOpen || !isLogsTab) {
      return;
    }
    void refreshEntries();
  }, [activeSessionId, detailLevel, isLogsTab, isOpen, namespace, refreshEntries, scope]);

  useEffect(() => {
    if (!isOpen || !terminalHostRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Consolas, "SFMono-Regular", ui-monospace, monospace',
      fontSize: 14,
      lineHeight: 1.25,
      letterSpacing: 0.2,
      theme: {
        background: '#18181f',
        foreground: '#f0f3f8',
        cursor: '#7dd3fc',
        black: '#111318',
        brightBlack: '#7b8193',
        red: '#f87171',
        brightRed: '#fca5a5',
        green: '#4ade80',
        brightGreen: '#86efac',
        yellow: '#facc15',
        brightYellow: '#fde047',
        blue: '#60a5fa',
        brightBlue: '#93c5fd',
        magenta: '#c084fc',
        brightMagenta: '#d8b4fe',
        cyan: '#22d3ee',
        brightCyan: '#67e8f9',
        white: '#e5e7eb',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHostRef.current);
    fitAddon.fit();

    terminal.onData((data) => {
      const currentTabId = activeTabIdRef.current;
      if (!currentTabId) {
        return;
      }
      void window.electronAPI?.terminal.write(currentTabId, data);
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    return () => {
      fitAddonRef.current?.dispose();
      fitAddonRef.current = null;
      terminalRef.current?.dispose();
      terminalRef.current = null;
      renderedStateRef.current = { tabId: null, length: 0 };
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !terminalHostRef.current || !terminalRef.current || !fitAddonRef.current) {
      return;
    }

    const resizeTerminal = () => {
      fitAddonRef.current?.fit();
      const cols = terminalRef.current?.cols ?? 0;
      const rows = terminalRef.current?.rows ?? 0;
      if (activeShellTab && cols > 0 && rows > 0) {
        void window.electronAPI?.terminal.resize(activeShellTab.tabId, cols, rows);
      }
    };

    const observer = new ResizeObserver(() => {
      resizeTerminal();
    });

    observer.observe(terminalHostRef.current);
    resizeTerminal();

    return () => observer.disconnect();
  }, [activeShellTab, isOpen, isLogsTab]);

  useEffect(() => {
    if (!isOpen || isLogsTab || !terminalRef.current || !activeShellTab) {
      return;
    }

    const renderedState = renderedStateRef.current;
    if (renderedState.tabId !== activeShellTab.tabId) {
      terminalRef.current.reset();
      if (activeShellBuffer) {
        terminalRef.current.write(activeShellBuffer);
      }
      renderedStateRef.current = {
        tabId: activeShellTab.tabId,
        length: activeShellBuffer.length,
      };
      fitAddonRef.current?.fit();
      return;
    }

    if (activeShellBuffer.length < renderedState.length) {
      terminalRef.current.reset();
      if (activeShellBuffer) {
        terminalRef.current.write(activeShellBuffer);
      }
      renderedStateRef.current = {
        tabId: activeShellTab.tabId,
        length: activeShellBuffer.length,
      };
      fitAddonRef.current?.fit();
      return;
    }

    if (activeShellBuffer.length > renderedState.length) {
      terminalRef.current.write(activeShellBuffer.slice(renderedState.length));
      renderedStateRef.current = {
        tabId: activeShellTab.tabId,
        length: activeShellBuffer.length,
      };
    }
  }, [activeShellBuffer, activeShellTab, isLogsTab, isOpen]);

  return (
    <section
      className={`runtime-terminal-workspace ${isOpen ? 'open' : ''}`}
      data-testid="runtime-terminal"
      aria-hidden={!isOpen}
    >
      <div className="runtime-terminal-workspace-header">
        <div className="runtime-terminal-tabs" role="tablist" aria-label="Runtime terminal tabs">
          {shellTabs.map((tab) => (
            <div
              key={tab.tabId}
              className={`runtime-terminal-tab ${activeTabId === tab.tabId ? 'active' : ''}`}
            >
              <button
                type="button"
                className="runtime-terminal-tab-trigger"
                role="tab"
                aria-selected={activeTabId === tab.tabId}
                onClick={() => void activateTab(tab.tabId)}
                title={tab.cwd}
              >
                <span className="runtime-terminal-tab-icon" aria-hidden="true">&gt;_</span>
                <span className="runtime-terminal-tab-label">{formatTabLabel(tab)}</span>
              </button>
              <button
                type="button"
                className="runtime-terminal-tab-close"
                aria-label={`Close ${formatTabLabel(tab)}`}
                onClick={() => void closeShellTab(tab.tabId)}
              >
                ×
              </button>
            </div>
          ))}

          <button
            type="button"
            className={`runtime-terminal-tab runtime-terminal-tab-logs ${isLogsTab ? 'active' : ''}`}
            role="tab"
            aria-selected={isLogsTab}
            onClick={() => void activateTab(TERMINAL_LOGS_TAB_ID)}
          >
            <span className="runtime-terminal-tab-icon" aria-hidden="true">≡</span>
            <span className="runtime-terminal-tab-label">Logs</span>
          </button>

          <button
            type="button"
            className="runtime-terminal-add-tab"
            aria-label="New terminal tab"
            title="New terminal tab"
            onClick={() => void createShellTab(currentProject?.rootPath ?? null)}
          >
            +
          </button>
        </div>

        <button
          type="button"
          className="runtime-terminal-close-workspace"
          aria-label={t('terminal.close')}
          onClick={() => useTerminalStore.getState().toggleOpen()}
        >
          ×
        </button>
      </div>

      <div className="runtime-terminal-workspace-body">
        <div
          className={`runtime-terminal-shell-pane ${isLogsTab ? 'hidden' : ''}`}
          data-testid="runtime-terminal-shell-pane"
        >
          <div
            ref={terminalHostRef}
            className="runtime-terminal-shell-host"
            onClick={() => terminalRef.current?.focus()}
          />
        </div>

        <div
          className={`runtime-terminal-logs-pane ${isLogsTab ? '' : 'hidden'}`}
          data-testid="runtime-terminal-logs-pane"
        >
          <div className="runtime-terminal-logs-controls">
            <label className="runtime-terminal-select">
              <span>{t('terminal.scope')}</span>
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value as 'app' | 'session')}
                data-testid="runtime-terminal-scope"
              >
                <option value="session">{t('terminal.scopeSession')}</option>
                <option value="app">{t('terminal.scopeApp')}</option>
              </select>
            </label>

            <label className="runtime-terminal-select">
              <span>{t('terminal.namespace')}</span>
              <select
                value={namespace}
                onChange={(event) => setNamespace(event.target.value as typeof namespace)}
                data-testid="runtime-terminal-namespace"
              >
                <option value="all">{t('terminal.namespaceAll')}</option>
                <option value="system">{t('terminal.namespaceSystem')}</option>
                <option value="agent">{t('terminal.namespaceAgent')}</option>
                <option value="tool">{t('terminal.namespaceTool')}</option>
                <option value="device">{t('terminal.namespaceDevice')}</option>
                <option value="capture">{t('terminal.namespaceCapture')}</option>
                <option value="context">Context</option>
                <option value="llm">LLM</option>
              </select>
            </label>

            <label className="runtime-terminal-select">
              <span>{t('terminal.detail')}</span>
              <select
                value={detailLevel}
                onChange={(event) => setDetailLevel(event.target.value as typeof detailLevel)}
                data-testid="runtime-terminal-detail"
              >
                <option value="summary">{t('terminal.detailSummary')}</option>
                <option value="verbose">{t('terminal.detailVerbose')}</option>
                <option value="raw">{t('terminal.detailRaw')}</option>
              </select>
            </label>
          </div>

          <div className="runtime-terminal-logs-body scrollbar-thin">
            {isLoading ? (
              <div className="runtime-terminal-empty">{t('terminal.loading')}</div>
            ) : filteredEntries.length === 0 ? (
              <div className="runtime-terminal-empty">{emptyCopy}</div>
            ) : (
              filteredEntries.map((entry) => (
                <article
                  key={entry.id}
                  className={`runtime-terminal-entry namespace-${entry.namespace} severity-${entry.severity}`}
                  data-testid={`runtime-log-entry-${entry.id}`}
                >
                  <div className="runtime-terminal-entry-topline">
                    <span className="runtime-terminal-entry-time">{formatTimestamp(entry.timestamp)}</span>
                    <span className="runtime-terminal-entry-namespace">{entry.namespace}</span>
                    <span className="runtime-terminal-entry-title">{entry.title}</span>
                  </div>

                  <div className="runtime-terminal-entry-summary">{entry.summary}</div>

                  {detailLevel !== 'summary' && entry.detail && (
                    <div className="runtime-terminal-entry-detail">{entry.detail}</div>
                  )}

                  {detailLevel === 'raw' && entry.raw != null && (
                    <pre className="runtime-terminal-entry-raw">{formatRaw(entry.raw)}</pre>
                  )}
                </article>
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
};

export default TerminalDrawer;
