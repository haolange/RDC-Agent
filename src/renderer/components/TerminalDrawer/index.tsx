import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import type { TerminalDataEvent, TerminalExitEvent, TerminalTabRecord } from '@shared/types/terminal';
import {
  TERMINAL_DEFAULT_HEIGHT,
  TERMINAL_MAX_HEIGHT,
  TERMINAL_MIN_HEIGHT,
} from '@shared/constants/layout';
import { useI18n } from '../../i18n';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useLayoutStore } from '../../stores/layoutStore';
import { useSessionStore } from '../../stores/sessionStore';
import {
  type RuntimeNamespaceFilter,
  type RuntimeSeverityFilter,
  type TerminalDensity,
  type TerminalScopeFilter,
  useTerminalStore,
} from '../../stores/terminalStore';
import DropdownSelect, { type DropdownOption } from '../DropdownSelect';
import './TerminalDrawer.css';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const formatTimestamp = (timestamp: number): string =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const formatRaw = (value: RuntimeLogEntry['raw']): string => {
  if (value == null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
};

const formatShortId = (value?: string | null): string => {
  if (!value) {
    return '-';
  }
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
};

const formatTabLabel = (tab: TerminalTabRecord): string => {
  const cwd = tab.cwd?.split(/[\\/]/).filter(Boolean).slice(-2).join('\\') || tab.cwd;
  return cwd ? `PowerShell: ${cwd}` : tab.title;
};

const stringifyEntryForSearch = (entry: RuntimeLogEntry): string => [
  entry.title,
  entry.summary,
  entry.detail,
  entry.namespace,
  entry.severity,
  entry.sessionId,
  entry.projectId,
  entry.runId,
  formatRaw(entry.raw),
].filter(Boolean).join('\n').toLowerCase();

const buildEntryCopy = (entry: RuntimeLogEntry): string => [
  `time: ${new Date(entry.timestamp).toISOString()}`,
  `severity: ${entry.severity}`,
  `source: ${entry.namespace}`,
  `title: ${entry.title}`,
  `summary: ${entry.summary}`,
  entry.detail ? `detail: ${entry.detail}` : '',
  `sessionId: ${entry.sessionId ?? ''}`,
  `runId: ${entry.runId ?? ''}`,
  `projectId: ${entry.projectId ?? ''}`,
  entry.raw != null ? `raw:\n${formatRaw(entry.raw)}` : '',
].filter(Boolean).join('\n');

const matchesShellScope = (
  tab: TerminalTabRecord,
  scopeFilter: TerminalScopeFilter,
  sessionId: string | null,
  runId: string | null,
): boolean => {
  if (scopeFilter === 'app' || scopeFilter === 'all-sessions') {
    return true;
  }

  if (!sessionId || tab.sessionId !== sessionId) {
    return false;
  }

  if (scopeFilter === 'current-run') {
    return Boolean(runId) && tab.runId === runId;
  }

  return true;
};

export const TerminalDrawer: React.FC = () => {
  const { t } = useI18n();
  const fontScale = useAppSettingsStore((state) => state.settings.appearance.fontScale);
  const themeSetting = useAppSettingsStore((state) => state.settings.appearance.theme);
  const systemTheme = useAppSettingsStore((state) => state.systemTheme);
  const paths = useAppSettingsStore((state) => state.settings.paths);
  const terminalHeight = useLayoutStore((state) => state.terminalHeight);
  const setTerminalHeight = useLayoutStore((state) => state.setTerminalHeight);
  const persistLayout = useLayoutStore((state) => state.persistLayout);
  const currentProject = useSessionStore((state) => state.currentProject);
  const currentSession = useSessionStore((state) => state.currentSession);
  const currentRun = useSessionStore((state) => state.currentRun);

  const terminalHostRef = useRef<HTMLDivElement>(null);
  const activityBodyRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const renderedStateRef = useRef<{ tabId: string | null; length: number }>({ tabId: null, length: 0 });
  const activeTabIdRef = useRef<string | null>(null);
  const resizeStateRef = useRef<{ startY: number; startHeight: number; maxHeight: number } | null>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const resolvedTheme = themeSetting === 'system' ? systemTheme : themeSetting;
  const terminalFontSize = fontScale === 'small' ? 13 : fontScale === 'large' ? 15 : 14;
  const isE2E = navigator.webdriver;

  const isOpen = useTerminalStore((state) => state.isOpen);
  const view = useTerminalStore((state) => state.view);
  const scopeFilter = useTerminalStore((state) => state.scopeFilter);
  const namespaceFilter = useTerminalStore((state) => state.namespaceFilter);
  const severityFilter = useTerminalStore((state) => state.severityFilter);
  const density = useTerminalStore((state) => state.density);
  const query = useTerminalStore((state) => state.query);
  const followOutput = useTerminalStore((state) => state.followOutput);
  const expandedEntryIds = useTerminalStore((state) => state.expandedEntryIds);
  const activeSessionId = useTerminalStore((state) => state.sessionId);
  const activeRunId = useTerminalStore((state) => state.runId);
  const entries = useTerminalStore((state) => state.entries);
  const isLoading = useTerminalStore((state) => state.isLoading);
  const tabs = useTerminalStore((state) => state.tabs);
  const activeTabId = useTerminalStore((state) => state.activeTabId);
  const shellBuffers = useTerminalStore((state) => state.shellBuffers);
  const setView = useTerminalStore((state) => state.setView);
  const setScopeFilter = useTerminalStore((state) => state.setScopeFilter);
  const setNamespaceFilter = useTerminalStore((state) => state.setNamespaceFilter);
  const setSeverityFilter = useTerminalStore((state) => state.setSeverityFilter);
  const setDensity = useTerminalStore((state) => state.setDensity);
  const setQuery = useTerminalStore((state) => state.setQuery);
  const setFollowOutput = useTerminalStore((state) => state.setFollowOutput);
  const toggleEntryExpanded = useTerminalStore((state) => state.toggleEntryExpanded);
  const refreshEntries = useTerminalStore((state) => state.refreshEntries);
  const syncTabs = useTerminalStore((state) => state.syncTabs);
  const refreshTabs = useTerminalStore((state) => state.refreshTabs);
  const createShellTab = useTerminalStore((state) => state.createShellTab);
  const activateTab = useTerminalStore((state) => state.activateTab);
  const closeShellTab = useTerminalStore((state) => state.closeShellTab);
  const clearShellBuffer = useTerminalStore((state) => state.clearShellBuffer);
  const appendTerminalData = useTerminalStore((state) => state.appendTerminalData);
  const markTerminalExit = useTerminalStore((state) => state.markTerminalExit);

  const terminalTheme = useMemo(() => (
    resolvedTheme === 'light'
      ? {
          background: '#f8fafc',
          foreground: '#182231',
          cursor: '#1b9dcc',
          black: '#e2e8f0',
          brightBlack: '#64748b',
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
          background: '#0f1115',
          foreground: '#e6edf3',
          cursor: '#2fb0ca',
          black: '#101318',
          brightBlack: '#768292',
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

  const scopeOptions = useMemo<DropdownOption[]>(() => ([
    { value: 'current-session', label: t('terminal.scopeCurrentSession') },
    { value: 'current-run', label: t('terminal.scopeCurrentRun'), disabled: !activeRunId },
    { value: 'app', label: t('terminal.scopeApp') },
    { value: 'all-sessions', label: t('terminal.scopeAllSessions') },
  ]), [activeRunId, t]);

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

  const severityOptions = useMemo<DropdownOption[]>(() => ([
    { value: 'all', label: t('terminal.severityAll') },
    { value: 'error', label: t('terminal.severityError') },
    { value: 'warning', label: t('terminal.severityWarning') },
    { value: 'success', label: t('terminal.severitySuccess') },
    { value: 'info', label: t('terminal.severityInfo') },
  ]), [t]);

  const densityOptions = useMemo<DropdownOption[]>(() => ([
    { value: 'compact', label: t('terminal.densityCompact') },
    { value: 'expanded', label: t('terminal.densityExpanded') },
  ]), [t]);

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return entries.filter((entry) => {
      if (namespaceFilter !== 'all' && entry.namespace !== namespaceFilter) {
        return false;
      }

      if (severityFilter !== 'all' && entry.severity !== severityFilter) {
        return false;
      }

      if (normalizedQuery && !stringifyEntryForSearch(entry).includes(normalizedQuery)) {
        return false;
      }

      return true;
    });
  }, [entries, namespaceFilter, query, severityFilter]);

  const effectiveScopeFilter = useMemo<TerminalScopeFilter>(() => {
    if (!activeSessionId && (scopeFilter === 'current-session' || scopeFilter === 'current-run')) {
      return 'app';
    }
    return scopeFilter;
  }, [activeSessionId, scopeFilter]);

  const shellTabs = useMemo(
    () => tabs
      .filter((tab) => tab.kind === 'shell')
      .filter((tab) => matchesShellScope(tab, effectiveScopeFilter, activeSessionId, activeRunId)),
    [activeRunId, activeSessionId, effectiveScopeFilter, tabs],
  );

  const activeShellTab = useMemo(
    () => shellTabs.find((tab) => tab.tabId === activeTabId) ?? shellTabs[0] ?? null,
    [activeTabId, shellTabs],
  );

  const activeShellBuffer = activeShellTab ? (shellBuffers[activeShellTab.tabId] ?? '') : '';
  const scopeLabel = scopeOptions.find((option) => option.value === effectiveScopeFilter)?.label ?? t('terminal.scopeCurrentSession');
  const titleContext = (() => {
    if (effectiveScopeFilter === 'app') {
      return t('terminal.scopeApp');
    }
    if (effectiveScopeFilter === 'all-sessions') {
      return t('terminal.scopeAllSessions');
    }
    if (effectiveScopeFilter === 'current-run') {
      return activeRunId
        ? `${scopeLabel} · ${formatShortId(activeRunId)}`
        : scopeLabel;
    }
    return activeSessionId
      ? `${scopeLabel} · ${formatShortId(activeSessionId)}`
      : t('terminal.scopeApp');
  })();

  const emptyCopy = (() => {
    if (effectiveScopeFilter === 'current-run') {
      return activeRunId ? t('terminal.emptyRun') : t('terminal.emptyRunHint');
    }
    if (effectiveScopeFilter === 'current-session') {
      return activeSessionId ? t('terminal.emptySession') : t('terminal.emptySessionHint');
    }
    if (effectiveScopeFilter === 'app') {
      return t('terminal.emptyApp');
    }
    return t('terminal.emptyAllSessions');
  })();

  useEffect(() => {
    activeTabIdRef.current = view === 'shell' ? activeShellTab?.tabId ?? null : null;
  }, [activeShellTab?.tabId, view]);

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

    void refreshTabs();
    if (view === 'activity') {
      void refreshEntries();
    }
  }, [activeRunId, activeSessionId, isOpen, refreshEntries, refreshTabs, scopeFilter, view]);

  useEffect(() => {
    if (!followOutput || view !== 'activity') {
      return;
    }
    const body = activityBodyRef.current;
    if (!body) {
      return;
    }
    body.scrollTop = body.scrollHeight;
  }, [filteredEntries.length, followOutput, view]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const targetElement = event.target as Element | null;
      if (
        filterMenuRef.current?.contains(target)
        || targetElement?.closest?.('.dropdown-select-menu')
      ) {
        return;
      }
      setFiltersOpen(false);
    };

    if (filtersOpen) {
      document.addEventListener('mousedown', handlePointerDown);
    }

    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [filtersOpen]);

  useEffect(() => {
    if (!isOpen || view !== 'shell' || isE2E || !terminalHostRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Consolas, "SFMono-Regular", ui-monospace, monospace',
      fontSize: terminalFontSize,
      lineHeight: 1.25,
      letterSpacing: 0,
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
  }, [isE2E, isOpen, terminalFontSize, terminalTheme, view]);

  useEffect(() => {
    if (!terminalRef.current) {
      return;
    }

    terminalRef.current.options.fontSize = terminalFontSize;
    terminalRef.current.options.theme = terminalTheme;
    fitAddonRef.current?.fit();
  }, [terminalFontSize, terminalTheme]);

  useEffect(() => {
    if (!isOpen || view !== 'shell' || !terminalHostRef.current || !terminalRef.current || !fitAddonRef.current) {
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
  }, [activeShellTab, isOpen, terminalHeight, view]);

  useEffect(() => {
    if (!isOpen || view !== 'shell' || !terminalRef.current || !activeShellTab) {
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
  }, [activeShellBuffer, activeShellTab, isOpen, view]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resizeState = resizeStateRef.current;
      if (!resizeState) {
        return;
      }

      const nextHeight = clamp(
        resizeState.startHeight - (event.clientY - resizeState.startY),
        TERMINAL_MIN_HEIGHT,
        resizeState.maxHeight,
      );
      setTerminalHeight(nextHeight);
      fitAddonRef.current?.fit();
    };

    const handlePointerUp = () => {
      if (!resizeStateRef.current) {
        return;
      }
      resizeStateRef.current = null;
      setIsResizing(false);
      document.body.classList.remove('terminal-resizing');
      void persistLayout();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.classList.remove('terminal-resizing');
    };
  }, [persistLayout, setTerminalHeight]);

  const handleResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const appMain = (event.currentTarget.closest('.app-main') as HTMLElement | null);
    const maxByViewport = appMain
      ? Math.floor(appMain.getBoundingClientRect().height * 0.65)
      : TERMINAL_MAX_HEIGHT;
    resizeStateRef.current = {
      startY: event.clientY,
      startHeight: terminalHeight,
      maxHeight: clamp(maxByViewport, TERMINAL_MIN_HEIGHT, TERMINAL_MAX_HEIGHT),
    };
    setIsResizing(true);
    document.body.classList.add('terminal-resizing');
  };

  const handleResizeDoubleClick = () => {
    setTerminalHeight(TERMINAL_DEFAULT_HEIGHT);
    fitAddonRef.current?.fit();
    void persistLayout();
  };

  const handleCreateShell = useCallback(() => {
    void createShellTab({
      cwd: currentProject?.rootPath ?? null,
      sessionId: currentSession?.sessionId ?? null,
      projectId: currentProject?.projectId ?? null,
      runId: currentRun?.runId ?? null,
    });
  }, [createShellTab, currentProject?.projectId, currentProject?.rootPath, currentRun?.runId, currentSession?.sessionId]);

  const handleCopyEntry = useCallback((entry: RuntimeLogEntry) => {
    void window.electronAPI?.appShell.copyText(buildEntryCopy(entry));
  }, []);

  const handleOpenLogsPath = useCallback(() => {
    if (paths.logsPath) {
      void window.electronAPI?.appShell.openPath(paths.logsPath);
    }
  }, [paths.logsPath]);

  const handleOpenWorkspacePath = useCallback(() => {
    if (paths.workspaceRoot) {
      void window.electronAPI?.appShell.openPath(paths.workspaceRoot);
    }
  }, [paths.workspaceRoot]);

  const handleCopyCwd = useCallback(() => {
    if (activeShellTab?.cwd) {
      void window.electronAPI?.appShell.copyText(activeShellTab.cwd);
    }
  }, [activeShellTab?.cwd]);

  return (
    <section
      className={`runtime-terminal-workspace ${isOpen ? 'open' : ''} ${isResizing ? 'resizing' : ''}`}
      data-testid="runtime-terminal"
      aria-hidden={!isOpen}
      style={{ ['--runtime-terminal-height' as string]: `${terminalHeight}px` }}
    >
      <div
        className="runtime-terminal-resize-handle"
        data-testid="runtime-terminal-resize-handle"
        aria-hidden="true"
        onPointerDown={handleResizePointerDown}
        onDoubleClick={handleResizeDoubleClick}
      />

      <div className="runtime-terminal-titlebar">
        <div className="runtime-terminal-title-group">
          <div className="runtime-terminal-title">
            <span className="runtime-terminal-title-glyph" aria-hidden="true">&gt;_</span>
            <span>{t('terminal.title')}</span>
          </div>
          <div className="runtime-terminal-subtitle">{titleContext}</div>
        </div>

        <button
          type="button"
          className="runtime-terminal-close-workspace"
          aria-label={t('terminal.close')}
          onClick={() => useTerminalStore.getState().toggleOpen()}
        >
          <span className="runtime-terminal-close-mark" aria-hidden="true" />
        </button>
      </div>

      <div className="runtime-terminal-toolbar">
        <div className="runtime-terminal-view-tabs" role="tablist" aria-label={t('terminal.viewTabs')}>
          <button
            type="button"
            className={`runtime-terminal-view-tab ${view === 'activity' ? 'active' : ''}`}
            role="tab"
            aria-selected={view === 'activity'}
            data-testid="runtime-terminal-activity-tab"
            onClick={() => setView('activity')}
          >
            {t('terminal.activity')}
          </button>
          <button
            type="button"
            className={`runtime-terminal-view-tab ${view === 'shell' ? 'active' : ''}`}
            role="tab"
            aria-selected={view === 'shell'}
            data-testid="runtime-terminal-shell-tab"
            onClick={() => setView('shell')}
          >
            {t('terminal.shell')}
          </button>
        </div>

        <div className="runtime-terminal-tools">
          <label className="runtime-terminal-select compact">
            <span>{t('terminal.scope')}</span>
            <DropdownSelect
              variant="inline"
              value={effectiveScopeFilter}
              options={scopeOptions}
              dataTestId="runtime-terminal-scope"
              onChange={(nextValue) => setScopeFilter(nextValue as TerminalScopeFilter)}
            />
          </label>

          <div ref={filterMenuRef} className="runtime-terminal-filter-menu">
            <button
              type="button"
              className={`runtime-terminal-tool-button ${filtersOpen ? 'active' : ''}`}
              data-testid="runtime-terminal-filter-toggle"
              aria-haspopup="menu"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((current) => !current)}
            >
              {t('terminal.filters')}
            </button>
            {filtersOpen && (
              <div className="runtime-terminal-filter-popover" role="menu">
                <label className="runtime-terminal-select stacked">
                  <span>{t('terminal.source')}</span>
                  <DropdownSelect
                    variant="inline"
                    value={namespaceFilter}
                    options={namespaceOptions}
                    dataTestId="runtime-terminal-namespace"
                    onChange={(nextValue) => setNamespaceFilter(nextValue as RuntimeNamespaceFilter)}
                  />
                </label>
                <label className="runtime-terminal-select stacked">
                  <span>{t('terminal.level')}</span>
                  <DropdownSelect
                    variant="inline"
                    value={severityFilter}
                    options={severityOptions}
                    dataTestId="runtime-terminal-severity"
                    onChange={(nextValue) => setSeverityFilter(nextValue as RuntimeSeverityFilter)}
                  />
                </label>
                <label className="runtime-terminal-select stacked">
                  <span>{t('terminal.density')}</span>
                  <DropdownSelect
                    variant="inline"
                    value={density}
                    options={densityOptions}
                    dataTestId="runtime-terminal-density"
                    onChange={(nextValue) => setDensity(nextValue as TerminalDensity)}
                  />
                </label>
              </div>
            )}
          </div>

          <label className="runtime-terminal-search">
            <span className="sr-only">{t('terminal.search')}</span>
            <input
              type="search"
              value={query}
              data-testid="runtime-terminal-search"
              placeholder={t('terminal.search')}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <button
            type="button"
            className={`runtime-terminal-tool-button ${followOutput ? 'active' : ''}`}
            data-testid="runtime-terminal-follow"
            aria-pressed={followOutput}
            onClick={() => setFollowOutput(!followOutput)}
          >
            {t('terminal.follow')}
          </button>
        </div>
      </div>

      <div className="runtime-terminal-workspace-body">
        <div
          className={`runtime-terminal-activity-pane ${view === 'activity' ? '' : 'hidden'}`}
          data-testid="runtime-terminal-activity-pane"
        >
          <div ref={activityBodyRef} className="runtime-terminal-activity-body scrollbar-thin">
            {isLoading ? (
              <div className="runtime-terminal-empty">{t('terminal.loading')}</div>
            ) : filteredEntries.length === 0 ? (
              <div className="runtime-terminal-empty">{emptyCopy}</div>
            ) : (
              filteredEntries.map((entry) => {
                const isExpanded = density === 'expanded' || expandedEntryIds.includes(entry.id);
                return (
                  <article
                    key={entry.id}
                    className={`runtime-terminal-entry namespace-${entry.namespace} severity-${entry.severity} ${isExpanded ? 'expanded' : ''}`}
                    data-testid={`runtime-log-entry-${entry.id}`}
                  >
                    <button
                      type="button"
                      className="runtime-terminal-entry-main"
                      onClick={() => toggleEntryExpanded(entry.id)}
                      aria-expanded={isExpanded}
                    >
                      <span className="runtime-terminal-entry-time">{formatTimestamp(entry.timestamp)}</span>
                      <span className={`runtime-terminal-severity severity-${entry.severity}`}>{entry.severity}</span>
                      <span className={`runtime-terminal-entry-namespace namespace-${entry.namespace}`}>{entry.namespace}</span>
                      <span className="runtime-terminal-entry-title">{entry.title}</span>
                      <span className="runtime-terminal-entry-summary">{entry.summary}</span>
                    </button>

                    {isExpanded && (
                      <div className="runtime-terminal-entry-details">
                        {entry.detail && (
                          <div className="runtime-terminal-entry-detail">{entry.detail}</div>
                        )}
                        <div className="runtime-terminal-entry-meta">
                          <span>session {formatShortId(entry.sessionId)}</span>
                          <span>run {formatShortId(entry.runId)}</span>
                          <span>project {formatShortId(entry.projectId)}</span>
                        </div>
                        {entry.raw != null && (
                          <pre className="runtime-terminal-entry-raw">{formatRaw(entry.raw)}</pre>
                        )}
                        <div className="runtime-terminal-entry-actions">
                          <button type="button" onClick={() => handleCopyEntry(entry)}>
                            {t('terminal.copyContext')}
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
        </div>

        <div
          className={`runtime-terminal-shell-pane ${view === 'shell' ? '' : 'hidden'}`}
          data-testid="runtime-terminal-shell-pane"
        >
          <div className="runtime-terminal-shell-header">
            <div className="runtime-terminal-shell-tabs" role="tablist" aria-label={t('terminal.shellTabs')}>
              {shellTabs.map((tab) => (
                <div
                  key={tab.tabId}
                  className={`runtime-terminal-shell-tab ${activeShellTab?.tabId === tab.tabId ? 'active' : ''}`}
                >
                  <button
                    type="button"
                    className="runtime-terminal-shell-tab-trigger"
                    role="tab"
                    aria-selected={activeShellTab?.tabId === tab.tabId}
                    onClick={() => void activateTab(tab.tabId)}
                    title={tab.cwd}
                  >
                    <span className="runtime-terminal-tab-icon" aria-hidden="true">&gt;_</span>
                    <span className="runtime-terminal-tab-label">{formatTabLabel(tab)}</span>
                    <span className={`runtime-terminal-shell-status ${tab.status}`}>{tab.status}</span>
                  </button>
                  <button
                    type="button"
                    className="runtime-terminal-tab-close"
                    aria-label={t('terminal.closeTab', { label: formatTabLabel(tab) })}
                    onClick={() => void closeShellTab(tab.tabId)}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>

            <div className="runtime-terminal-shell-actions">
              <button type="button" onClick={handleCreateShell}>{t('terminal.newShell')}</button>
              <button type="button" onClick={() => activeShellTab && void closeShellTab(activeShellTab.tabId)} disabled={!activeShellTab}>
                {t('terminal.terminateShell')}
              </button>
              <button type="button" onClick={() => activeShellTab && clearShellBuffer(activeShellTab.tabId)} disabled={!activeShellTab}>
                {t('terminal.clearShell')}
              </button>
              <button type="button" onClick={handleCopyCwd} disabled={!activeShellTab}>
                {t('terminal.copyCwd')}
              </button>
              <button type="button" onClick={handleOpenLogsPath} disabled={!paths.logsPath}>
                {t('terminal.openLogs')}
              </button>
              <button type="button" onClick={handleOpenWorkspacePath} disabled={!paths.workspaceRoot}>
                {t('terminal.openWorkspace')}
              </button>
            </div>
          </div>

          <div className="runtime-terminal-shell-context">
            <span>{t('terminal.cwd')}: {activeShellTab?.cwd ?? currentProject?.rootPath ?? paths.workspaceRoot}</span>
            <span>{t('terminal.scopeCurrentSession')}: {formatShortId(activeShellTab?.sessionId ?? currentSession?.sessionId)}</span>
            <span>{t('terminal.scopeCurrentRun')}: {formatShortId(activeShellTab?.runId ?? currentRun?.runId)}</span>
          </div>

          {shellTabs.length === 0 ? (
            <div className="runtime-terminal-shell-empty">
              <div>{t('terminal.shellEmpty')}</div>
              <button type="button" onClick={handleCreateShell}>{t('terminal.newShell')}</button>
            </div>
          ) : (
            <div
              ref={terminalHostRef}
              className="runtime-terminal-shell-host"
              onClick={() => terminalRef.current?.focus()}
            />
          )}
        </div>
      </div>
    </section>
  );
};

export default TerminalDrawer;
