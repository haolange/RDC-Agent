import { taskDependencyWait } from './taskDependencies';
import type { TaskRecord, TaskStatus } from './TaskRegistry';
import type { TaskExecutionRecord } from './TaskContracts';
import type { TaskDisplayState } from '@shared/types/conversation';
import type { TaskDependencyWait } from '@shared/types/taskExecution';
import type { TaskExecutionFacts } from '@shared/types/trace';

export type ProjectedTaskStatus = TaskStatus;

export interface ProjectedTaskItem {
  order: number;
  taskId: string;
  title: string;
  status: ProjectedTaskStatus;
  displayState: TaskDisplayState;
  execution?: TaskExecutionFacts;
  statusReason?: string;
  waitingOn?: TaskDependencyWait[];
}

/** An open Task whose current execution failed or was interrupted shows as failed; otherwise its status. */
export function taskDisplayState(
  task: Pick<TaskRecord, 'status'>,
  current: Pick<TaskExecutionRecord, 'status'> | undefined,
): TaskDisplayState {
  const open = task.status !== 'completed' && task.status !== 'cancelled';
  return open && (current?.status === 'failed' || current?.status === 'interrupted') ? 'failed' : task.status;
}

export function taskExecutionFacts(execution: TaskExecutionRecord): TaskExecutionFacts {
  const preparation = execution.preparation;
  return {
    mode: execution.mode,
    status: execution.status,
    ...(execution.dispatch ? { dispatch: execution.dispatch } : {}),
    ...(preparation?.profileId ? { agentId: preparation.profileId } : {}),
    ...(preparation?.providerId && preparation.modelId
      ? {
          model: {
            providerId: preparation.providerId,
            modelId: preparation.modelId,
            ...(preparation.reasoningLevel ? { reasoningLevel: preparation.reasoningLevel } : {}),
          },
        }
      : {}),
  };
}

export function createdAtFromTaskId(id: string): number {
  const match = /^task_(\d+)_/u.exec(id);
  if (!match) return 0;
  const ms = Number(match[1]);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

export function orderTasks(records: readonly TaskRecord[]): TaskRecord[] {
  return records.slice().sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

export function projectTaskItems(
  records: readonly TaskRecord[],
  executions: readonly TaskExecutionRecord[] = [],
): ProjectedTaskItem[] {
  const ordered = orderTasks(records);
  const byId = new Map(ordered.map((task) => [task.id, task] as const));
  const byExecution = new Map(executions.map((execution) => [execution.id, execution] as const));
  return ordered.map((task, order) => {
    const waitingOn =
      task.status === 'pending'
        ? task.blockedBy.flatMap((id) => {
            const dependency = byId.get(id);
            const wait = taskDependencyWait(
              id,
              dependency,
              dependency?.currentExecutionId ? byExecution.get(dependency.currentExecutionId) : undefined,
            );
            return wait ? [wait] : [];
          })
        : [];
    const current = task.currentExecutionId ? byExecution.get(task.currentExecutionId) : undefined;
    return {
      order,
      taskId: task.id,
      title: task.subject,
      status: task.status,
      displayState: taskDisplayState(task, current),
      ...(current ? { execution: taskExecutionFacts(current) } : {}),
      statusReason: task.statusReason,
      ...(waitingOn.length ? { waitingOn } : {}),
    };
  });
}
