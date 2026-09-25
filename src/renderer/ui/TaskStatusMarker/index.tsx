import React from 'react';
import './TaskStatusMarker.css';

export type TaskLifecycleStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'cancelled';

export interface TaskStatusMarkerProps {
  status: TaskLifecycleStatus;
  order: number;
  variant?: 'number' | 'snapshot';
  label?: string;
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

export const TaskStatusMarker: React.FC<TaskStatusMarkerProps> = ({ status, order, variant = 'number', label }) => {
  const variantClass = variant === 'snapshot' ? ' is-snapshot' : '';
  if (variant === 'snapshot') {
    const icon = status === 'pending'
      ? <circle cx="8" cy="8" r="6" />
      : status === 'in_progress'
        ? <><circle cx="8" cy="8" r="6" /><path d="M5 8h6m-2-2 2 2-2 2" /></>
        : status === 'completed'
          ? <><circle cx="8" cy="8" r="6" /><path d="m5 8 2 2 4-4" /></>
          : status === 'blocked'
            ? <><circle cx="8" cy="8" r="6" /><path d="M8 4.75v4m0 2.5h.01" /></>
            : <><circle cx="8" cy="8" r="6" /><path d="m6 6 4 4m0-4-4 4" /></>;
    return <span className={`task-status-marker${variantClass} is-${status.replace('_', '-')}`} aria-label={label ?? status}>
      <svg viewBox="0 0 16 16" aria-hidden="true">{icon}</svg>
    </span>;
  }
  if (status === 'completed') {
    return <span className="task-status-marker is-completed" aria-label={label ?? 'completed'}><CheckIcon /></span>;
  }
  if (status === 'cancelled') {
    return <span className="task-status-marker is-cancelled" aria-label={label ?? 'cancelled'}><CancelIcon /></span>;
  }
  if (status === 'blocked') {
    return <span className="task-status-marker is-blocked" aria-label={label ?? 'blocked'}><BlockedIcon /></span>;
  }
  return (
    <span
      className={`task-status-marker ${status === 'in_progress' ? 'is-in-progress' : 'is-pending'}`}
      aria-label={label ?? status}
    >
      {order + 1}
    </span>
  );
};
