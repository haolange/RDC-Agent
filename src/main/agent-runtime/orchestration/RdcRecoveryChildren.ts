import { getDelegatedChildSessionId, getRdcContextLease } from '../../rdc/RdcRuntimeContextRegistry';
import { createSessionTaskStore, getDelegatedTaskScope, TaskRegistry, type TaskExecutionRecord } from '../tasks';
import type { TurnHandle } from './TurnCoordinator';

const TERMINAL = new Set(['completed', 'partial', 'blocked', 'failed', 'cancelled', 'interrupted']);

/** Stop only the child which held the faulted lease; unrelated offline work remains intact. */
export async function joinFaultedRdcChild(sessionId: string, turn: TurnHandle, signal?: AbortSignal): Promise<void> {
  const childId = getDelegatedChildSessionId(sessionId);
  if (!childId) return;
  const lease = getRdcContextLease(childId);
  if (!lease?.quarantineReason || !lease.quarantineCause || lease.delegatedFrom !== sessionId || lease.ownerTurnId !== turn.turnId) {
    throw new Error('RDC_RECOVERY_CHILD_ACTIVE: an unrelated or unverified delegated lease must finish first.');
  }
  const scope = getDelegatedTaskScope(childId);
  if (!scope) {
    const joined = await boundedJoin(turn.abortProducerForRecovery(childId), signal);
    if (!joined) throw new Error('RDC_RECOVERY_CHILD_OWNER_MISSING');
  } else {
    if (scope.ownerSessionId !== sessionId || !scope.executionId || !scope.generation) throw new Error('RDC_RECOVERY_CHILD_OWNER_MISSING');
    const registry = new TaskRegistry(createSessionTaskStore(sessionId));
    const executions = await registry.listExecutions();
    const root = executions.find(value => value.id === scope.executionId && value.generation === scope.generation);
    if (!root || TERMINAL.has(root.status)) throw new Error('RDC_RECOVERY_CHILD_OWNER_MISSING');
    const selected = affectedExecutions(executions, root.id);
    for (const execution of selected) {
      signal?.throwIfAborted();
      await boundedJoin(registry.interruptExecutionForRecovery(execution.id, execution.generation), signal);
    }
    if (affectedExecutions(await registry.listExecutions(), root.id).length) throw new Error('RDC_RECOVERY_CHILD_ACTIVE');
  }
  signal?.throwIfAborted();
  if (getDelegatedChildSessionId(sessionId)) throw new Error('RDC_RECOVERY_CHILD_EXIT_UNCONFIRMED');
}

function affectedExecutions(executions: readonly TaskExecutionRecord[], rootId: string): TaskExecutionRecord[] {
  const byId = new Map(executions.map(value => [value.id, value]));
  const depth = (value: TaskExecutionRecord): number => {
    if (value.id === rootId) return 0;
    let parent = value.parentExecutionId; let distance = 1; const visited = new Set<string>();
    while (parent && !visited.has(parent)) {
      if (parent === rootId) return distance;
      visited.add(parent); parent = byId.get(parent)?.parentExecutionId; distance += 1;
    }
    return -1;
  };
  return executions.map(value => ({ value, depth: depth(value) }))
    .filter(entry => entry.depth >= 0 && entry.value.mode === 'subagent' && !TERMINAL.has(entry.value.status))
    .sort((a, b) => b.depth - a.depth).map(entry => entry.value);
}

/** An unjoined child keeps ownership; a timeout never counts as exit evidence. */
async function boundedJoin<T>(joining: Promise<T>, signal?: AbortSignal): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const stop = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new DOMException('Recovery was cancelled.', 'AbortError'));
    if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => reject(new Error('RDC_RECOVERY_CHILD_EXIT_UNCONFIRMED: child join timed out.')), 15_000);
    timer.unref?.();
  });
  try { return await Promise.race([joining, stop]); }
  finally { if (timer) clearTimeout(timer); if (abort) signal?.removeEventListener('abort', abort); }
}
