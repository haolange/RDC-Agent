import React from 'react';
import './TaskStatusMarker.css';

export type TaskLifecycleStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export interface TaskStatusMarkerProps {
  status: TaskLifecycleStatus;
  label?: string;
}

const stateClasses: Record<TaskLifecycleStatus, string> = { pending: 'is-pending', in_progress: 'is-in-progress', blocked: 'is-blocked', completed: 'is-completed', cancelled: 'is-cancelled' };

export const TaskStatusMarker: React.FC<TaskStatusMarkerProps> = ({ status, label }) => {
    const icon = status === 'pending'
      ? <circle cx="8" cy="8" r="6" />
      : status === 'in_progress'
        ? <><circle cx="8" cy="8" r="6" /><path d="M5 8h6m-2-2 2 2-2 2" /></>
        : status === 'completed'
          ? <><circle cx="8" cy="8" r="6" /><path d="m5 8 2 2 4-4" /></>
          : status === 'blocked'
            ? <><circle cx="8" cy="8" r="6" /><path d="M8 4.75v4m0 2.5h.01" /></>
            : <><circle cx="8" cy="8" r="6" /><path d="m6 6 4 4m0-4-4 4" /></>;
    return <span className={`task-status-marker is-snapshot ${stateClasses[status]}`} aria-label={label ?? status} title={label ?? status}>
      <svg viewBox="0 0 16 16" aria-hidden="true">{icon}</svg>
    </span>;
};
