import type { TaskDependencyWait } from '@shared/types/taskExecution';
import type { TaskExecutionRecord, TaskRecord } from './TaskContracts';

/** The same dependency evidence governs admission and its read-only explanation. */
export function taskDependencyWait(
  taskId: string, dependency: TaskRecord | null | undefined, proof?: TaskExecutionRecord | null,
): TaskDependencyWait | undefined {
  if (!dependency) return { taskId, reason: 'missing' };
  const reason = dependency.status !== 'completed' ? 'unfinished'
    : dependency.disposition !== 'completed' || (dependency.executionRequired && (
      !proof || proof.taskId !== dependency.id || proof.taskRevision !== dependency.revision
      || proof.status !== 'completed' || proof.result?.disposition !== 'completed'
    )) ? 'unverified' : undefined;
  return reason ? { taskId, title: dependency.subject, reason } : undefined;
}
