import type { TaskRecord, TaskStatus } from './TaskRegistry';
import type { TaskExecutionRecord } from './TaskContracts';
import type { TaskDependencyWait } from '@shared/types/taskExecution';
import { taskDependencyWait } from './taskDependencies';

export type ProjectedTaskStatus = TaskStatus;

export interface ProjectedTaskItem {
  order: number;
  taskId: string;
  title: string;
  status: ProjectedTaskStatus;
  statusReason?: string;
  waitingOn?: TaskDependencyWait[];
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

export function projectTaskItems(records: readonly TaskRecord[], executions: readonly TaskExecutionRecord[] = []): ProjectedTaskItem[] {
  const ordered = orderTasks(records);
  const byId = new Map(ordered.map((task) => [task.id, task] as const));
  const byExecution = new Map(executions.map(execution => [execution.id, execution] as const));
  return ordered.map((task, order) => {
    const waitingOn = task.status === 'pending' ? task.blockedBy.flatMap(id => {
      const dependency = byId.get(id);
      const wait = taskDependencyWait(id, dependency, dependency?.currentExecutionId ? byExecution.get(dependency.currentExecutionId) : undefined);
      return wait ? [wait] : [];
    }) : [];
    return {
      order,
      taskId: task.id,
      title: task.subject,
      status: task.status,
      statusReason: task.statusReason,
      ...(waitingOn.length ? { waitingOn } : {}),
    };
  });
}
