import React, { useState } from 'react';
import type { RunSummary } from '@shared/types/session';

interface TaskHistoryProps {
  runs: RunSummary[];
}

const formatRelativeTime = (timestamp: number | undefined): string => {
  if (!timestamp) {
    return '—';
  }
  const diff = Date.now() - timestamp;
  if (diff < 0) {
    return 'just now';
  }
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const STATUS_LABEL: Record<RunSummary['status'], string> = {
  queued: 'Queued',
  planning: 'Planning',
  awaiting_input: 'Awaiting input',
  awaiting_approval: 'Awaiting approval',
  running: 'Running',
  stopping: 'Stopping',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};

const STATUS_TONE: Record<RunSummary['status'], 'success' | 'warning' | 'muted'> = {
  queued: 'muted',
  planning: 'muted',
  awaiting_input: 'muted',
  awaiting_approval: 'muted',
  running: 'muted',
  stopping: 'muted',
  completed: 'success',
  failed: 'warning',
  cancelled: 'warning',
  interrupted: 'warning',
};

export const TaskHistory: React.FC<TaskHistoryProps> = ({ runs }) => {
  const [expanded, setExpanded] = useState(false);

  if (runs.length === 0) {
    return null;
  }

  const orderedRuns = [...runs].sort((a, b) => {
    const aTs = a.finishedAt ?? a.stoppedAt ?? a.startedAt;
    const bTs = b.finishedAt ?? b.stoppedAt ?? b.startedAt;
    return bTs - aTs;
  });

  return (
    <div
      className={`task-history ${expanded ? 'is-expanded' : 'is-collapsed'}`}
      data-testid="task-history"
    >
      <button
        type="button"
        className="task-history-toggle"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        data-testid="task-history-toggle"
      >
        <span className="task-history-toggle-arrow" aria-hidden="true">
          <svg viewBox="0 0 12 12" width="10" height="10">
            <path
              d="M3 4.5 L6 7.5 L9 4.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="task-history-toggle-label">History</span>
        <span className="task-history-toggle-count">{runs.length}</span>
      </button>
      <div
        className="task-history-body"
        data-testid="task-history-body"
        aria-hidden={!expanded}
      >
        <ul className="task-history-list">
          {orderedRuns.map((run) => {
            const tone = STATUS_TONE[run.status];
            const finishedAt = run.finishedAt ?? run.stoppedAt;
            const isSuccess = tone === 'success';
            return (
              <li
                key={run.runId}
                className={`task-history-run tone-${tone}`}
                data-testid="task-history-run"
                data-run-id={run.runId}
              >
                <span
                  className={`task-history-mark ${isSuccess ? 'success' : 'warning'}`}
                  aria-hidden="true"
                >
                  {isSuccess ? (
                    <svg viewBox="0 0 12 12" width="10" height="10">
                      <path
                        d="M2.5 6.2 L5 8.6 L9.6 3.6"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 12 12" width="10" height="10">
                      <path
                        d="M3 3 L9 9 M9 3 L3 9"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  )}
                </span>
                <span className="task-history-run-copy">
                  <span className="task-history-run-title">
                    {run.goal || `Run ${run.runId.slice(0, 8)}`}
                  </span>
                  <span className="task-history-run-meta">
                    <span className="task-history-run-status">{STATUS_LABEL[run.status]}</span>
                    <span className="task-history-run-dot" aria-hidden="true">·</span>
                    <span className="task-history-run-time">{formatRelativeTime(finishedAt)}</span>
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
};

export default TaskHistory;
