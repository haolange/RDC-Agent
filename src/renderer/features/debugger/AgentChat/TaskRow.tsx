import React from 'react';
import type { WorkProcessRow } from './workProcessPresentation';
import { getRowStatusLabel } from './workProcessPresentation';

interface TaskRowProps {
  row: Extract<WorkProcessRow, { type: 'task' }>;
}

const TASK_STATUS_ICON: Record<string, string> = {
  pending: '○',
  in_progress: '◐',
  completed: '●',
  failed: '✕',
};

/**
 * Task row：渲染 task 工具产出的任务状态卡片。
 *
 * 实时状态（pending/in_progress/completed/failed）+ 标题。
 */
export const TaskRow: React.FC<TaskRowProps> = ({ row }) => {
  const statusLabel = getRowStatusLabel(row.status);
  const icon = TASK_STATUS_ICON[row.taskStatus] ?? TASK_STATUS_ICON.pending;

  return (
    <li className={`work-process-task status-${row.status}`} data-testid="work-process-task">
      <span className={`work-process-task-icon task-${row.taskStatus}`} aria-hidden="true">{icon}</span>
      <span className="work-process-task-title">{row.title}</span>
      {statusLabel ? <span className={`work-process-task-status status-${row.status}`}>{statusLabel}</span> : null}
      {row.duration ? <span className="work-process-task-duration">{row.duration}</span> : null}
    </li>
  );
};
