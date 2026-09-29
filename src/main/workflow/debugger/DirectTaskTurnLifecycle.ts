import { TaskRegistry, createSessionTaskStore, getDelegatedTaskScope } from '../../agent-runtime/tasks';
import { processSupervisor } from '../../runtime/ProcessSupervisor';
import { TASK_STATUS_REASONS } from '@shared/constants/taskStatusReasons';

const TERMINAL = new Set(['completed', 'partial', 'blocked', 'failed', 'cancelled', 'interrupted']);

export async function listUnfinishedDirectTasks(input: {
  sessionId?: string | null;
  turnId: string;
  generation: number;
}): Promise<Array<{ executionId: string; taskId: string }>> {
  if (!input.sessionId) return [];
  const delegatedScope = getDelegatedTaskScope(input.sessionId);
  const registry = new TaskRegistry(createSessionTaskStore(delegatedScope?.ownerSessionId ?? input.sessionId));
  const frozenPlanRef = `turn:${input.turnId}:generation:${input.generation}`;
  return (await registry.listExecutions())
    .filter((execution) => execution.mode === 'direct' && execution.frozenPlanRef === frozenPlanRef && !TERMINAL.has(execution.status))
    .map((execution) => ({ executionId: execution.id, taskId: execution.taskId }));
}

export async function settleUnfinishedDirectTasks(input: {
  sessionId?: string | null;
  turnId: string;
  generation: number;
  stopped: boolean;
}): Promise<number> {
  if (!input.sessionId) return 0;
  const delegatedScope = getDelegatedTaskScope(input.sessionId);
  const registry = new TaskRegistry(createSessionTaskStore(delegatedScope?.ownerSessionId ?? input.sessionId));
  const unfinished = await listUnfinishedDirectTasks(input);
  for (const execution of unfinished) {
    const current = await registry.getExecution(execution.executionId);
    if (!current || TERMINAL.has(current.status)) continue;
    await registry.settleExecution(current.id, {
      expectedGeneration: current.generation,
      status: input.stopped ? 'cancelled' : 'blocked',
      result: input.stopped
        ? { disposition: 'cancelled', summary: TASK_STATUS_REASONS.parentTurnStopped, outputs: {} }
        : { disposition: 'blocked', summary: 'Parent turn ended without settling this direct Task execution.', outputs: {} },
    });
  }
  return unfinished.length;
}

/** A stopped turn cannot leave its unstarted logical Tasks actionable in a rewrite. */
export async function cancelPendingCreatedTasks(registry: TaskRegistry, turnRef: string): Promise<number> {
  const tasks = await registry.listTasks();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const belongsTo = (taskId: string, ancestorId: string): boolean => {
    let parentId = byId.get(taskId)?.parentTaskId;
    while (parentId) {
      if (parentId === ancestorId) return true;
      parentId = byId.get(parentId)?.parentTaskId;
    }
    return false;
  };
  let cancelled = 0;
  for (const task of tasks.slice().reverse()) {
    if (task.creationTurnRef !== turnRef || task.status !== 'pending') continue;
    // cancelTask cascades. Leave a parent alone if another turn owns unfinished descendants.
    if (tasks.some((child) => child.creationTurnRef !== turnRef
      && child.status !== 'completed' && child.status !== 'cancelled'
      && belongsTo(child.id, task.id))) continue;
    const current = await registry.getTask(task.id);
    if (current?.status !== 'pending') continue;
    await registry.cancelTask(task.id, TASK_STATUS_REASONS.createdTurnStopped);
    cancelled += 1;
  }
  return cancelled;
}

export async function settleJoinedTurnTaskExecutions(input: {
  sessionId?: string | null;
  turnId: string;
  generation: number;
  stopped: boolean;
  orphaned: boolean;
}): Promise<void> {
  if (input.orphaned) return;
  if (!input.sessionId) return;
  const delegatedScope = getDelegatedTaskScope(input.sessionId);
  const registry = new TaskRegistry(createSessionTaskStore(delegatedScope?.ownerSessionId ?? input.sessionId));
  const frozenPlanRef = `turn:${input.turnId}:generation:${input.generation}`;
  const hasDirectExecution = (await registry.listExecutions()).some((execution) => (
    execution.mode === 'direct' && execution.frozenPlanRef === frozenPlanRef && !TERMINAL.has(execution.status)
  ));
  if (hasDirectExecution) {
    await processSupervisor.joinExecutionProcesses(input.sessionId);
    if (processSupervisor.hasUnconfirmedProcesses(input.sessionId)) return;
    if (input.stopped) await settleUnfinishedDirectTasks(input);
  }
  if (input.stopped) await cancelPendingCreatedTasks(registry, frozenPlanRef);
}
