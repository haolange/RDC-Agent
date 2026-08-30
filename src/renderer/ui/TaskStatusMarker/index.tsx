import React from 'react';
import './TaskStatusMarker.css';

export type TaskLifecycleStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export interface TaskStatusMarkerProps {
  status: TaskLifecycleStatus;
  order: number;
}

const CheckIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.25 8.25 3 3 6.5-7" /></svg>
);

const CancelIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
);

const BlockedIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.25v5m0 3.5h.01" /></svg>
);

export const TaskStatusMarker: React.FC<TaskStatusMarkerProps> = ({ status, order }) => {
  if (status === 'completed') {
    return <span className="task-status-marker is-completed" aria-label="completed"><CheckIcon /></span>;
  }
  if (status === 'cancelled') {
    return <span className="task-status-marker is-cancelled" aria-label="cancelled"><CancelIcon /></span>;
  }
  if (status === 'blocked') {
    return <span className="task-status-marker is-blocked" aria-label="blocked"><BlockedIcon /></span>;
  }
  return (
    <span
      className={`task-status-marker ${status === 'in_progress' ? 'is-in-progress' : 'is-pending'}`}
      aria-label={status}
    >
      {order + 1}
    </span>
  );
};
