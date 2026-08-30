import type { TaskRecord, TaskStatus } from './TaskRegistry';

export type ProjectedTaskStatus = TaskStatus;

export interface ProjectedTaskItem {
  order: number;
  taskId: string;
  title: string;
  status: ProjectedTaskStatus;
  statusReason?: string;
}

export function createdAtFromTaskId(id: string): number {
  const match = /^task_(\d+)_/u.exec(id);
  if (!match) return 0;
  const ms = Number(match[1]);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

export function orderTasks(records: readonly TaskRecord[]): TaskRecord[] {
  return records
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

export function projectTaskItems(records: readonly TaskRecord[]): ProjectedTaskItem[] {
  const ordered = orderTasks(records);
  const byId = new Map(ordered.map((task) => [task.id, task] as const));
  const completed = new Set(ordered.filter((task) => task.status === 'completed').map((task) => task.id));
  return ordered.map((task, order) => {
    const blockers = task.blockedBy
      .map((id) => byId.get(id))
      .filter((blocker): blocker is TaskRecord => blocker !== undefined && !completed.has(blocker.id));
    const status: ProjectedTaskStatus = task.status === 'completed'
      || task.status === 'cancelled'
      || task.status === 'blocked'
      || task.status === 'in_progress'
      ? task.status
      : blockers.length > 0 ? 'blocked' : 'pending';
    return {
      order,
      taskId: task.id,
      title: task.subject,
      status,
      statusReason: task.statusReason ?? (blockers.length > 0
        ? blockers.map((blocker) => blocker.subject).join(', ')
        : undefined),
    };
  });
}
