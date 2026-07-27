import React from 'react';
import type { WorkProcessRow } from './workProcessPresentation';

interface TaskRowProps {
  row: Extract<WorkProcessRow, { type: 'task' }>;
}

const TaskStateIcon: React.FC<{ status: string }> = ({ status }) => {
  if (status === 'completed') return <svg viewBox="0 0 16 16"><path d="m3.5 8.1 2.7 2.7 6.3-6.1" /></svg>;
  if (status === 'blocked') return <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" /><path d="M8 5.1v3.3M8 10.7h.01" /></svg>;
  if (status === 'cancelled') return <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5" /><path d="m5.5 5.5 5 5m0-5-5 5" /></svg>;
  if (status === 'in_progress') return <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.8" /><path d="M8 5.4v2.8l1.9 1.3" /></svg>;
  return <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.8" /></svg>;
};

/** A task event is rendered once as a compact Todo-like state row. */
export const TaskRow: React.FC<TaskRowProps> = ({ row }) => {
  const statusLabel = row.taskStatus === 'blocked'
    ? row.taskStatusReason ? `Blocked · ${row.taskStatusReason}` : 'Blocked'
    : row.taskStatus === 'in_progress'
      ? 'In progress'
      : row.taskStatus === 'cancelled'
        ? 'Cancelled'
        : '';

  return (
    <li
      className={`work-process-task status-${row.status} task-${row.taskStatus}`}
      data-testid="work-process-task"
      data-work-process-task-id={row.taskId}
      data-work-process-task-status={row.taskStatus}
      tabIndex={-1}
    >
      <span className={`work-process-task-icon task-${row.taskStatus}`} aria-hidden="true"><TaskStateIcon status={row.taskStatus} /></span>
      <span className="work-process-task-content">
        <span className="work-process-task-title">{row.title}</span>
        {statusLabel ? <span className={`work-process-task-status status-${row.status}`}>{statusLabel}</span> : null}
      </span>
    </li>
  );
};
