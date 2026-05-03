import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import {
  TERMINAL_DEFAULT_HEIGHT,
  TERMINAL_MAX_HEIGHT,
  TERMINAL_MIN_HEIGHT,
} from '@shared/constants/layout';
import { useI18n } from '../../i18n';
import { useLayoutStore } from '../../stores/layoutStore';
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

export const TerminalDrawer: React.FC = () => {
  const { t } = useI18n();
  const terminalHeight = useLayoutStore((state) => state.terminalHeight);
  const setTerminalHeight = useLayoutStore((state) => state.setTerminalHeight);
  const persistLayout = useLayoutStore((state) => state.persistLayout);

  const activityBodyRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<{ startY: number; startHeight: number; maxHeight: number } | null>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const isOpen = useTerminalStore((state) => state.isOpen);
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
  const setScopeFilter = useTerminalStore((state) => state.setScopeFilter);
  const setNamespaceFilter = useTerminalStore((state) => state.setNamespaceFilter);
  const setSeverityFilter = useTerminalStore((state) => state.setSeverityFilter);
  const setDensity = useTerminalStore((state) => state.setDensity);
  const setQuery = useTerminalStore((state) => state.setQuery);
  const setFollowOutput = useTerminalStore((state) => state.setFollowOutput);
  const toggleEntryExpanded = useTerminalStore((state) => state.toggleEntryExpanded);
  const refreshEntries = useTerminalStore((state) => state.refreshEntries);

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
    if (!isOpen) {
      return;
    }

    void refreshEntries();
  }, [activeRunId, activeSessionId, isOpen, refreshEntries, scopeFilter]);

  useEffect(() => {
    if (!followOutput) {
      return;
    }
    const body = activityBodyRef.current;
    if (!body) {
      return;
    }
    body.scrollTop = body.scrollHeight;
  }, [filteredEntries.length, followOutput]);

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
    void persistLayout();
  };

  const handleCopyEntry = useCallback((entry: RuntimeLogEntry) => {
    void window.electronAPI?.appShell.copyText(buildEntryCopy(entry));
  }, []);

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
            <span className="runtime-terminal-title-glyph activity" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
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
          className="runtime-terminal-activity-pane"
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
      </div>
    </section>
  );
};

export default TerminalDrawer;
