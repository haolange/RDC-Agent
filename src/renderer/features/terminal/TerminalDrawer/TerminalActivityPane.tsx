import React from 'react';
import type { RuntimeLogEntry } from '@shared/types/runtimeLog';
import {
  formatRaw,
  formatTimestamp,
  formatShortId,
} from './terminalFormatters';
import type { TerminalDrawerViewModel } from './useTerminalDrawer';

interface TerminalActivityPaneProps {
  vm: TerminalDrawerViewModel;
}

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

  return (
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
          filteredEntries.map((entry) => (
            <TerminalLogEntry
              key={entry.id}
              entry={entry}
              isExpanded={density === 'expanded' || expandedEntryIds.includes(entry.id)}
              onToggle={() => toggleEntryExpanded(entry.id)}
              onCopy={() => handleCopyEntry(entry)}
              copyLabel={t('terminal.copyContext')}
            />
          ))
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
