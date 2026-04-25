import React, { useEffect, useMemo, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import type { TerminalDataEvent, TerminalExitEvent, TerminalTabRecord } from '@shared/types/terminal';
import { useI18n } from '../../i18n';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useSessionStore } from '../../stores/sessionStore';
import { TERMINAL_LOGS_TAB_ID, useTerminalStore } from '../../stores/terminalStore';
import DropdownSelect, { type DropdownOption } from '../DropdownSelect';
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
  const fontScale = useAppSettingsStore((state) => state.settings.appearance.fontScale);
  const themeSetting = useAppSettingsStore((state) => state.settings.appearance.theme);
  const systemTheme = useAppSettingsStore((state) => state.systemTheme);
  const terminalHostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const renderedStateRef = useRef<{ tabId: string | null; length: number }>({ tabId: null, length: 0 });
  const activeTabIdRef = useRef<string | null>(null);

  const currentProject = useSessionStore((state) => state.currentProject);
  const resolvedTheme = themeSetting === 'system' ? systemTheme : themeSetting;
  const terminalFontSize = fontScale === 'small' ? 13 : fontScale === 'large' ? 15 : 14;
  const isE2E = navigator.webdriver;
  const terminalTheme = useMemo(() => (
    resolvedTheme === 'light'
      ? {
          background: '#f4f7fb',
          foreground: '#1a2333',
          cursor: '#0f8fcb',
          black: '#dfe6ef',
          brightBlack: '#718096',
          red: '#d64545',
          brightRed: '#ea6b6b',
          green: '#2f8c57',
          brightGreen: '#4daf77',
          yellow: '#a46c00',
          brightYellow: '#c48a13',
          blue: '#2b6dd8',
          brightBlue: '#5b8ff0',
          magenta: '#8f52d1',
          brightMagenta: '#b57df0',
          cyan: '#0b86a8',
          brightCyan: '#37a9cc',
          white: '#1a2333',
          brightWhite: '#0f1723',
        }
      : {
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
        }
  ), [resolvedTheme]);

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

  const scopeOptions = useMemo<DropdownOption[]>(() => ([
    { value: 'session', label: t('terminal.scopeSession') },
    { value: 'app', label: t('terminal.scopeApp') },
  ]), [t]);

  const namespaceOptions = useMemo<DropdownOption[]>(() => ([
    { value: 'all', label: t('terminal.namespaceAll') },
    { value: 'system', label: t('terminal.namespaceSystem') },
    { value: 'agent', label: t('terminal.namespaceAgent') },
    { value: 'tool', label: t('terminal.namespaceTool') },
    { value: 'device', label: t('terminal.namespaceDevice') },
    { value: 'capture', label: t('terminal.namespaceCapture') },
    { value: 'context', label: t('terminal.namespaceContext') },
    { value: 'llm', label: t('terminal.namespaceLlm') },
  ]), [t]);

  const detailOptions = useMemo<DropdownOption[]>(() => ([
    { value: 'summary', label: t('terminal.detailSummary') },
    { value: 'verbose', label: t('terminal.detailVerbose') },
    { value: 'raw', label: t('terminal.detailRaw') },
  ]), [t]);

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

    if (!isE2E && shellTabs.length === 0) {
      void ensureShellTab(currentProject?.rootPath ?? null);
    }
  }, [
    currentProject?.rootPath,
    ensureShellTab,
    isE2E,
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
    if (!isOpen || isE2E || !terminalHostRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Consolas, "SFMono-Regular", ui-monospace, monospace',
      fontSize: terminalFontSize,
      lineHeight: 1.25,
      letterSpacing: 0.2,
      theme: terminalTheme,
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
  }, [isE2E, isOpen, terminalFontSize, terminalTheme]);

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    terminalRef.current.options.fontSize = terminalFontSize;
    terminalRef.current.options.theme = terminalTheme;
    fitAddonRef.current?.fit();
  }, [terminalFontSize, terminalTheme]);

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
        <div className="runtime-terminal-tabs" role="tablist" aria-label={t('terminal.tabs')}>
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
                aria-label={t('terminal.closeTab', { label: formatTabLabel(tab) })}
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
            <span className="runtime-terminal-tab-label">{t('terminal.logsTab')}</span>
          </button>

          <button
            type="button"
            className="runtime-terminal-add-tab"
            aria-label={t('terminal.newTab')}
            title={t('terminal.newTab')}
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
              <DropdownSelect
                variant="inline"
                value={scope}
                options={scopeOptions}
                dataTestId="runtime-terminal-scope"
                onChange={(nextValue) => setScope(nextValue as 'app' | 'session')}
              />
            </label>

            <label className="runtime-terminal-select">
              <span>{t('terminal.namespace')}</span>
              <DropdownSelect
                variant="inline"
                value={namespace}
                options={namespaceOptions}
                dataTestId="runtime-terminal-namespace"
                onChange={(nextValue) => setNamespace(nextValue as typeof namespace)}
              />
            </label>

            <label className="runtime-terminal-select">
              <span>{t('terminal.detail')}</span>
              <DropdownSelect
                variant="inline"
                value={detailLevel}
                options={detailOptions}
                dataTestId="runtime-terminal-detail"
                onChange={(nextValue) => setDetailLevel(nextValue as typeof detailLevel)}
              />
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
