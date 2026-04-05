import React, { useEffect, useMemo, useRef } from 'react';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import { useI18n } from '../../i18n';
import { useTerminalStore } from '../../stores/terminalStore';
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

export const TerminalDrawer: React.FC = () => {
  const { t } = useI18n();
  const scrollRef = useRef<HTMLDivElement>(null);

  const isOpen = useTerminalStore((state) => state.isOpen);
  const scope = useTerminalStore((state) => state.scope);
  const namespace = useTerminalStore((state) => state.namespace);
  const detailLevel = useTerminalStore((state) => state.detailLevel);
  const activeSessionId = useTerminalStore((state) => state.activeSessionId);
  const entries = useTerminalStore((state) => state.entries);
  const isLoading = useTerminalStore((state) => state.isLoading);
  const setScope = useTerminalStore((state) => state.setScope);
  const setNamespace = useTerminalStore((state) => state.setNamespace);
  const setDetailLevel = useTerminalStore((state) => state.setDetailLevel);
  const refreshEntries = useTerminalStore((state) => state.refreshEntries);

  useEffect(() => {
    void refreshEntries();
  }, [activeSessionId, refreshEntries, scope]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const node = scrollRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [entries, isOpen]);

  const filteredEntries = useMemo(() => (
    namespace === 'all'
      ? entries
      : entries.filter((entry) => entry.namespace === namespace)
  ), [entries, namespace]);

  const emptyCopy = scope === 'session'
    ? (activeSessionId ? t('terminal.emptySession') : t('terminal.emptySessionHint'))
    : t('terminal.emptyApp');

  return (
    <section
      className={`runtime-terminal ${isOpen ? 'open' : ''}`}
      data-testid="runtime-terminal"
      aria-hidden={!isOpen}
    >
      <div className="runtime-terminal-header">
        <div className="runtime-terminal-header-copy">
          <div className="runtime-terminal-title">{t('terminal.title')}</div>
          <div className="runtime-terminal-subtitle">{filteredEntries.length}</div>
        </div>

        <div className="runtime-terminal-controls">
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
      </div>

      <div
        ref={scrollRef}
        className="runtime-terminal-body scrollbar-thin"
        data-testid="runtime-terminal-body"
      >
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
    </section>
  );
};

export default TerminalDrawer;
