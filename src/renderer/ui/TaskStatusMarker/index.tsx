import React from 'react';
import { cn } from '../../lib/cn';
import type { TaskDisplayState } from '@shared/types/conversation';
import './TaskStatusMarker.css';

export type TaskStatusMarkerSize = 'sm' | 'md';

export interface TaskStatusMarkerProps {
  /** Display state projected by main; `failed` is derived there from the current execution, never here. */
  status: TaskDisplayState;
  label: string;
  size?: TaskStatusMarkerSize;
}

const glyphs: Record<TaskDisplayState, React.ReactNode> = {
  pending: <circle className="task-status-marker-ring" cx="8" cy="8" r="5.5" />,
  in_progress: (
    <>
      <circle className="task-status-marker-track" cx="8" cy="8" r="5.5" />
      <path className="task-status-marker-arc" d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5" />
      <circle className="task-status-marker-core" cx="8" cy="8" r="2" />
    </>
  ),
  completed: (
    <>
      <circle className="task-status-marker-fill" cx="8" cy="8" r="6.5" />
      <path className="task-status-marker-mark" d="m5.25 8.25 1.9 1.9 3.6-3.9" />
    </>
  ),
  blocked: (
    <>
      <circle className="task-status-marker-ring" cx="8" cy="8" r="5.5" />
      <path className="task-status-marker-glyph" d="M6.6 6v4M9.4 6v4" />
    </>
  ),
  failed: (
    <>
      <circle className="task-status-marker-fill" cx="8" cy="8" r="6.5" />
      <path className="task-status-marker-mark" d="M8 4.9v3.6M8 11h.01" />
    </>
  ),
  cancelled: (
    <>
      <circle className="task-status-marker-ring" cx="8" cy="8" r="5.5" />
      <path className="task-status-marker-glyph" d="m4.4 11.6 7.2-7.2" />
    </>
  ),
};

/** One glyph per Task display state; color comes from the `--token-task-*` family. */
export const TaskStatusMarker: React.FC<TaskStatusMarkerProps> = ({ status, label, size = 'md' }) => (
  <span
    className={cn('task-status-marker', `is-${status.replace('_', '-')}`, `is-size-${size}`)}
    role="img"
    aria-label={label}
    data-tooltip={label}
  >
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {glyphs[status]}
    </svg>
  </span>
);
