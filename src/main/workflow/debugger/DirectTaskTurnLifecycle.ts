import { TaskRegistry, createSessionTaskStore, getDelegatedTaskScope } from '../../agent-runtime/tasks';
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
  if (!hasDirectExecution) return;
  if (input.sessionId) await processSupervisor.joinExecutionProcesses(input.sessionId);
  if (input.sessionId && processSupervisor.hasUnconfirmedProcesses(input.sessionId)) return;
  if (input.stopped) await settleUnfinishedDirectTasks(input);
}
