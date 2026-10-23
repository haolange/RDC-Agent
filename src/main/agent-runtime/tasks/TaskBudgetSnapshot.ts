import type { TaskBudgetState, TaskExecutionRecord, TaskRecord, TaskRootBudgetRecord } from './TaskContracts';
import type { TaskRegistry } from './TaskRegistry';

export interface TaskLiveBudgetSnapshot {
  turnId: string;
  generation: number;
  policyChain: TaskBudgetState[];
  remainingPolicy: { toolCalls: number; subagents: number; wallTimeMs: number };
  reservedSubagentSlots: number;
  /** Admission check only; the requested Capsule still needs its own actual allocation. */
  subagentTreeAdmission: { allowed: boolean; reason: string | null; childrenSpawned: number; activeChildren: number };
}

export interface TaskBudgetSnapshot {
  observedAt: number;
  isReservation: false;
  unavailableReason: 'no-execution' | 'execution-missing' | 'root-unbound' | 'root-missing' | null;
  execution: Pick<TaskExecutionRecord, 'id' | 'generation' | 'mode' | 'status' | 'budget' | 'updatedAt'> | null;
  root: TaskRootBudgetRecord | null;
  rootRemaining: { toolCalls: number; subagents: number; wallTimeMs: number } | null;
  live: TaskLiveBudgetSnapshot | null;
}

/** Read existing accounting only. Missing records never create or bind a budget. */
export async function readTaskBudgetSnapshot(
  registry: TaskRegistry,
  task: TaskRecord,
  readLiveBudget?: (rootBudgetId: string) => TaskLiveBudgetSnapshot | null,
): Promise<TaskBudgetSnapshot> {
  const execution = task.currentExecutionId ? await registry.getExecution(task.currentExecutionId) : null;
  if (execution && (execution.taskId !== task.id || execution.id !== task.currentExecutionId)) {
    throw new Error('TASK_BUDGET_EXECUTION_MISMATCH');
  }
  const root = execution?.rootBudgetId ? await registry.getRootBudget(execution.rootBudgetId) : null;
  if (root && root.id !== execution!.rootBudgetId) throw new Error('TASK_BUDGET_ROOT_ID_MISMATCH');
  const observedAt = Date.now();
  return {
    observedAt,
    isReservation: false,
    unavailableReason: !task.currentExecutionId ? 'no-execution' : !execution ? 'execution-missing'
      : !execution.rootBudgetId ? 'root-unbound' : !root ? 'root-missing' : null,
    execution: execution ? { id: execution.id, generation: execution.generation, mode: execution.mode,
      status: execution.status, budget: execution.budget, updatedAt: execution.updatedAt } : null,
    root,
    rootRemaining: root ? {
      toolCalls: Math.max(0, root.maxToolCalls - root.toolCalls),
      subagents: Math.max(0, root.maxSubagents - root.subagents),
      wallTimeMs: Math.max(0, root.deadlineAt - observedAt),
    } : null,
    live: root && execution?.status === 'running' ? readLiveBudget?.(root.id) ?? null : null,
  };
}
