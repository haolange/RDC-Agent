import React, { useCallback, useEffect, useState } from 'react';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import { useDynStyle } from '../../../lib/useDynStyle';
import { EmptyState } from '../../../ui/EmptyState';
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
          <div role="status"><EmptyState layout="compact" title={t('terminal.loading')} /></div>
        ) : filteredEntries.length === 0 ? (
          <EmptyState layout="fill" title={emptyCopy} />
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
}) => (
  <article
    className={`runtime-terminal-entry namespace-${entry.namespace} severity-${entry.severity} ${isExpanded ? 'expanded' : ''}`}
    data-testid={`runtime-log-entry-${entry.id}`}
  >
    <button
      type="button"
      className="runtime-terminal-entry-main"
      onClick={onToggle}
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
          <button type="button" onClick={onCopy}>
            {copyLabel}
          </button>
        </div>
      </div>
    )}
  </article>
);
