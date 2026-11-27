import type { TaskDependencyWait } from '@shared/types/taskExecution';
import type { TaskExecutionRecord, TaskRecord } from './TaskContracts';

/**
 * A partial result for the current revision with a deliverable reference: its uncertainty is stated, and the work that
 * depends on it may go on with it, as a partial answer is a delivery.
 */
export function isPartialDelivery(dependency: TaskRecord, proof?: TaskExecutionRecord | null): boolean {
  return (
    dependency.disposition === 'partial' &&
    proof?.taskId === dependency.id &&
    proof.taskRevision === dependency.revision &&
    proof.status === 'partial' &&
    proof.result?.disposition === 'partial' &&
    Boolean(proof.result.resultRef)
  );
}

/** The same dependency evidence governs admission and its read-only explanation. */
export function taskDependencyWait(
  taskId: string,
  dependency: TaskRecord | null | undefined,
  proof?: TaskExecutionRecord | null,
): TaskDependencyWait | undefined {
  if (!dependency) return { taskId, reason: 'missing' };
  if (isPartialDelivery(dependency, proof)) return undefined;
  const reason =
    dependency.status !== 'completed'
      ? 'unfinished'
      : dependency.disposition !== 'completed' ||
          (dependency.executionRequired &&
            (!proof ||
              proof.taskId !== dependency.id ||
              proof.taskRevision !== dependency.revision ||
              proof.status !== 'completed' ||
              proof.result?.disposition !== 'completed'))
        ? 'unverified'
        : undefined;
  return reason ? { taskId, title: dependency.subject, reason } : undefined;
}
