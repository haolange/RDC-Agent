import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../../../i18n';
import { useDynStyle } from '../../../lib/useDynStyle';
import { Button } from '../../../ui/Button';
import { EmptyState } from '../../../ui/EmptyState';
import { Skeleton } from '../../../ui/Skeleton';
import {
  formatRaw,
  formatTimestamp,
  formatShortId,
} from './terminalFormatters';
import {
  TERMINAL_ENTRY_ESTIMATE,
  TERMINAL_WINDOW_OVERSCAN,
  TERMINAL_WINDOW_THRESHOLD,
  terminalActivityWindow,
} from './terminalActivityWindow';
import type { TranslationKey } from '../../../i18n';
import type { RuntimeLogEntry, RuntimeLogNamespace, RuntimeLogSeverity } from '@shared/types/runtimeLog';

const SEVERITY_LABEL_KEYS: Record<RuntimeLogSeverity, TranslationKey> = {
  info: 'terminal.severityInfo',
  success: 'terminal.severitySuccess',
  warning: 'terminal.severityWarning',
  error: 'terminal.severityError',
};

const NAMESPACE_LABEL_KEYS: Record<RuntimeLogNamespace, TranslationKey> = {
  system: 'terminal.namespaceSystem',
  agent: 'terminal.namespaceAgent',
  tool: 'terminal.namespaceTool',
  device: 'terminal.namespaceDevice',
  capture: 'terminal.namespaceCapture',
  context: 'terminal.namespaceContext',
  llm: 'terminal.namespaceLlm',
};
import type { TerminalDrawerViewModel } from './useTerminalDrawer';

interface TerminalActivityPaneProps {
  vm: TerminalDrawerViewModel;
}

const TerminalSpacer: React.FC<{ height: number }> = ({ height }) => {
  const dynStyle = useDynStyle({ height: `${height}px` });
  return <div aria-hidden="true" className="runtime-terminal-entry-spacer" {...dynStyle} />;
};

export const TerminalActivityPane: React.FC<TerminalActivityPaneProps> = ({ vm }) => {
  const {
    t,
    activityBodyRef,
    isLoading,
    filteredEntries,
    emptyCopy,
    density,
    expandedEntryIds,
    toggleEntryExpanded,
    handleCopyEntry,
  } = vm;
  const [range, setRange] = useState({ start: 0, end: Math.min(filteredEntries.length, 24) });

  const updateRange = useCallback(() => {
    const body = activityBodyRef.current;
    if (!body || filteredEntries.length <= TERMINAL_WINDOW_THRESHOLD) {
      setRange({ start: 0, end: filteredEntries.length });
      return;
    }
    const next = terminalActivityWindow(
      filteredEntries.length,
      body.scrollTop,
      body.clientHeight,
      TERMINAL_ENTRY_ESTIMATE,
      TERMINAL_WINDOW_OVERSCAN,
    );
    setRange((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, [activityBodyRef, filteredEntries.length]);

  useEffect(() => {
    const body = activityBodyRef.current;
    if (!body) {
      updateRange();
      return;
    }
    body.addEventListener('scroll', updateRange, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateRange()) : null;
    ro?.observe(body);
    updateRange();
    return () => {
      body.removeEventListener('scroll', updateRange);
      ro?.disconnect();
    };
  }, [activityBodyRef, updateRange]);

  useEffect(() => {
    updateRange();
  }, [filteredEntries.length, updateRange]);

  const windowed = filteredEntries.length > TERMINAL_WINDOW_THRESHOLD;
  const visible = windowed ? filteredEntries.slice(range.start, range.end) : filteredEntries;
  const leading = windowed ? range.start * TERMINAL_ENTRY_ESTIMATE : 0;
  const trailing = windowed
    ? Math.max(0, (filteredEntries.length - range.end) * TERMINAL_ENTRY_ESTIMATE)
    : 0;

  return (
    <div
      className="runtime-terminal-activity-pane"
      data-testid="runtime-terminal-activity-pane"
    >
      <div ref={activityBodyRef} className="runtime-terminal-activity-body scrollbar-thin">
        {isLoading ? (
          <div role="status" aria-label={t('terminal.loading')}><Skeleton shape="row" count={6} /></div>
        ) : filteredEntries.length === 0 ? (
          <EmptyState variant="page" title={emptyCopy} />
        ) : (
          <>
            {leading > 0 ? <TerminalSpacer height={leading} /> : null}
            {visible.map((entry) => (
              <TerminalLogEntry
                key={entry.id}
                entry={entry}
                isExpanded={density === 'expanded' || expandedEntryIds.includes(entry.id)}
                onToggle={() => toggleEntryExpanded(entry.id)}
                onCopy={() => handleCopyEntry(entry)}
                copyLabel={t('terminal.copyContext')}
              />
            ))}
            {trailing > 0 ? <TerminalSpacer height={trailing} /> : null}
          </>
        )}
      </div>
    </div>
  );
};

interface TerminalLogEntryProps {
  entry: RuntimeLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
  onCopy: () => void;
  copyLabel: string;
}

const TerminalLogEntry: React.FC<TerminalLogEntryProps> = ({
  entry,
  isExpanded,
  onToggle,
  onCopy,
  copyLabel,
}) => {
  const { t } = useI18n();
  return (
  <article
    className={`runtime-terminal-entry severity-${entry.severity} ${isExpanded ? 'expanded' : ''}`}
    data-testid={`runtime-log-entry-${entry.id}`}
  >
    <button
      type="button"
      className="runtime-terminal-entry-main"
      onClick={onToggle}
      aria-expanded={isExpanded}
    >
      <span className={`runtime-terminal-severity-dot severity-${entry.severity}`} role="img"
        aria-label={t(SEVERITY_LABEL_KEYS[entry.severity])} data-tooltip={t(SEVERITY_LABEL_KEYS[entry.severity])} />
      <span className="runtime-terminal-entry-time">{formatTimestamp(entry.timestamp)}</span>
      <span className="runtime-terminal-entry-title">{entry.title}</span>
      <span className="runtime-terminal-entry-summary">{entry.summary}</span>
    </button>

    {isExpanded && (
      <div className="runtime-terminal-entry-details">
        {entry.detail && (
          <div className="runtime-terminal-entry-detail">{entry.detail}</div>
        )}
        <div className="runtime-terminal-entry-meta">
          <span>{t('terminal.namespace')} {t(NAMESPACE_LABEL_KEYS[entry.namespace])}</span>
          <span>{t('terminal.metaSession')} {formatShortId(entry.sessionId)}</span>
          <span>{t('terminal.metaRun')} {formatShortId(entry.runId)}</span>
          <span>{t('terminal.metaProject')} {formatShortId(entry.projectId)}</span>
        </div>
        {entry.raw != null && (
          <pre className="runtime-terminal-entry-raw">{formatRaw(entry.raw)}</pre>
        )}
        <div className="runtime-terminal-entry-actions">
          <Button variant="ghost" size="sm" onClick={onCopy}>{copyLabel}</Button>
        </div>
      </div>
    )}
  </article>
  );
};
