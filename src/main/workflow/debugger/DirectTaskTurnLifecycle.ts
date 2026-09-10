import { TaskRegistry, createSessionTaskStore, getDelegatedTaskScope, registerTaskExecutionCancellationOwner } from '../../agent-runtime/tasks';
import type { TurnHandle } from './TurnCoordinator';

const preparedHandoffOwners = new Map<string, () => void>();
import { storageAdapter } from '../../sessions/StorageAdapter';
import { processSupervisor } from '../../runtime/ProcessSupervisor';

const TERMINAL = new Set(['completed', 'partial', 'blocked', 'failed', 'cancelled', 'interrupted']);

export async function settleUnfinishedDirectTasks(input: {
  sessionId?: string | null;
  turnId: string;
  generation: number;
  stopped: boolean;
}): Promise<number> {
  if (!input.sessionId) return 0;
  const delegatedScope = getDelegatedTaskScope(input.sessionId);
  const registry = new TaskRegistry(createSessionTaskStore(delegatedScope?.ownerSessionId ?? input.sessionId));
  const frozenPlanRef = `turn:${input.turnId}:generation:${input.generation}`;
  const unfinished = (await registry.listExecutions()).filter((execution) => (
    execution.mode === 'direct' && execution.frozenPlanRef === frozenPlanRef && !TERMINAL.has(execution.status)
  ));
  for (const execution of unfinished) {
    await registry.settleExecution(execution.id, {
      expectedGeneration: execution.generation,
      status: input.stopped ? 'cancelled' : 'blocked',
      result: input.stopped
        ? { disposition: 'cancelled', summary: 'Parent turn stopped after its producers joined.', outputs: {} }
        : { disposition: 'blocked', summary: 'Parent turn ended without settling this direct Task execution.', outputs: {} },
    });
  }
  return unfinished.length;
}

/**
 * Close the durable execution owned by the execute handoff consumed by this
 * turn. A prepared return carrying the same binding remains owned by the
 * handoff commit path, so it is deliberately left running here.
 */
export async function settleUnreturnedHandoffExecution(input: {
  sessionId?: string | null;
  turnId: string;
  stopped: boolean;
}): Promise<boolean> {
  if (!input.sessionId) return false;
  const document = storageAdapter.handoffs.readDocument(input.sessionId);
  const consumed = [...(document?.history ?? [])].reverse().find((entry) => (
    entry.lifecycle === 'consumed'
    && entry.continuationTurnId === input.turnId
    && entry.taskExecution
  ));
  const binding = consumed?.taskExecution;
  if (!binding) return false;
  const activeReturn = document?.active;
  if (
    activeReturn?.lifecycle === 'prepared'
    && activeReturn.taskExecution?.executionId === binding.executionId
    && activeReturn.taskExecution.generation === binding.generation
    && activeReturn.taskResult
  ) return false;

  const registry = new TaskRegistry(createSessionTaskStore(input.sessionId));
  const execution = await registry.getExecution(binding.executionId);
  if (!execution || TERMINAL.has(execution.status)) return false;
  await registry.settleExecution(binding.executionId, {
    expectedGeneration: binding.generation,
    status: input.stopped ? 'cancelled' : 'blocked',
    result: input.stopped
      ? { disposition: 'cancelled', summary: 'Receiving handoff turn stopped after its producers joined.', outputs: {} }
      : { disposition: 'blocked', summary: 'Receiving handoff turn ended without returning its execution result.', outputs: {} },
  });
  return true;
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
  const hasHandoffExecution = Boolean(getConsumedHandoffTaskBinding(input.sessionId, input.turnId));
  if (!hasDirectExecution && !hasHandoffExecution) return;
  if (input.sessionId) await processSupervisor.joinExecutionProcesses(input.sessionId);
  if (input.sessionId && processSupervisor.hasUnconfirmedProcesses(input.sessionId)) return;
  if (input.stopped) await settleUnfinishedDirectTasks(input);
  await settleUnreturnedHandoffExecution(input);
}

export function getConsumedHandoffTaskBinding(sessionId: string, turnId: string) {
  return [...(storageAdapter.handoffs.readDocument(sessionId)?.history ?? [])].reverse().find((entry) => (
    entry.lifecycle === 'consumed' && entry.continuationTurnId === turnId && entry.taskExecution
  ))?.taskExecution ?? null;
}

export async function registerReceivingHandoffTurnOwner(
  sessionId: string,
  turn: TurnHandle,
): Promise<(() => void) | undefined> {
  const binding = getConsumedHandoffTaskBinding(sessionId, turn.turnId);
  if (!binding) return undefined;
  preparedHandoffOwners.get(binding.executionId)?.();
  preparedHandoffOwners.delete(binding.executionId);
  const release = registerTaskExecutionCancellationOwner(binding.executionId, async () => {
    await turn.abortAndJoin({ reason: 'user_stop' });
    await processSupervisor.joinExecutionProcesses(sessionId);
    if (turn.isOrphaned) throw new Error('TASK_CANCELLATION_UNCONFIRMED: receiving turn producers did not stop.');
    if (processSupervisor.hasUnconfirmedProcesses(sessionId)) {
      throw new Error('TASK_CANCELLATION_UNCONFIRMED: receiving turn processes did not exit.');
    }
  });
  const execution = await new TaskRegistry(createSessionTaskStore(sessionId)).getExecution(binding.executionId);
  if (execution?.status === 'cancelling') await turn.abortAndJoin({ reason: 'user_stop' });
  return release;
}

export function registerPreparedHandoffExecutionOwner(sessionId: string, handoffId: string, executionId: string): void {
  preparedHandoffOwners.get(executionId)?.();
  const release = registerTaskExecutionCancellationOwner(executionId, async () => {
    const active = storageAdapter.handoffs.getActive(sessionId);
    if (active?.handoffId === handoffId) {
      storageAdapter.handoffs.cancel(sessionId, 'user_stop');
      return;
    }
    const consumed = [...(storageAdapter.handoffs.readDocument(sessionId)?.history ?? [])].reverse()
      .find((entry) => entry.handoffId === handoffId && entry.lifecycle === 'consumed');
    if (consumed) throw new Error('HANDOFF_TASK_TRANSFER_PENDING: receiving turn has not acquired cancellation ownership.');
    throw new Error('HANDOFF_TASK_OWNER_STALE: handoff binding is no longer active.');
  });
  preparedHandoffOwners.set(executionId, release);
}

export function releasePreparedHandoffExecutionOwner(executionId?: string): void {
  if (!executionId) return;
  preparedHandoffOwners.get(executionId)?.();
  preparedHandoffOwners.delete(executionId);
}
