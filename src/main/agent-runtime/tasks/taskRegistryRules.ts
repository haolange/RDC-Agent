/**
 * Pure rules of the Task registry: settlement results, terminal states, id lists, the
 * descendant tree, and inherited / validated execution budgets.
 */

import type { SettleTaskExecutionOptions, StartTaskExecutionOptions, TaskCompletionResult, TaskExecutionRecord, TaskRecord, TaskRootBudgetRecord, TaskStatus } from './TaskContracts';

export function validateResult(result: TaskCompletionResult, status: string): void { if (!result.summary.trim()) throw new Error('Execution result summary is required.'); if (Boolean(result.resultRef) !== Boolean(result.resultHash)) throw new Error('Execution result reference and hash must be provided together.'); const expected = status === 'failed' || status === 'interrupted' ? 'blocked' : status; if (result.disposition !== expected) throw new Error(`${status} execution requires ${expected} disposition.`); }
export function sameSettlement(execution: TaskExecutionRecord, options: SettleTaskExecutionOptions): boolean { return execution.status === options.status && JSON.stringify(execution.result) === JSON.stringify(options.result); }
export function isTerminalExecutionStatus(status: TaskExecutionRecord['status']): boolean { return status === 'completed' || status === 'partial' || status === 'blocked' || status === 'failed' || status === 'cancelled' || status === 'interrupted'; }
export function isTerminalTaskStatus(status: TaskStatus): boolean { return status === 'completed' || status === 'cancelled'; }
export function dedupeIds(values: readonly string[]): string[] { return [...new Set(values.filter((x) => typeof x === 'string' && x.length > 0))]; }
export function appendUnique(target: string[], incoming: readonly string[]): string[] { const added: string[] = []; for (const value of incoming) if (!target.includes(value)) { target.push(value); added.push(value); } return added; }
export function collectDescendants(parentId: string, tasks: readonly TaskRecord[]): TaskRecord[] { const result: TaskRecord[] = []; const pending = [parentId]; while (pending.length) { const current = pending.pop()!; for (const task of tasks) if (task.parentTaskId === current && !result.some((entry) => entry.id === task.id)) { result.push(task); pending.push(task.id); } } return result; }

export function inheritBudget(
  requested: StartTaskExecutionOptions['budget'],
  previous?: TaskExecutionRecord['budget'],
  parent?: TaskExecutionRecord['budget'],
): TaskExecutionRecord['budget'] {
  const sources = [requested, previous, parent].filter((value): value is NonNullable<typeof value> => Boolean(value));
  const minimum = (key: 'maxToolCalls' | 'maxSubagents' | 'maxChildDepth' | 'deadlineAt'): number | undefined => {
    const values = sources.map((source) => source[key]).filter((value): value is number => typeof value === 'number');
    return values.length ? Math.min(...values) : undefined;
  };
  const maximum = (key: 'toolCalls' | 'subagents' | 'childDepth'): number => {
    // The parent has its own local ledger. Only retries of this Task may carry
    // local consumption forward; the shared root ledger accounts for ancestors.
    return Math.max(0, requested?.[key] ?? 0, previous?.[key] ?? 0);
  };
  return {
    maxToolCalls: minimum('maxToolCalls'),
    toolCalls: maximum('toolCalls'),
    maxSubagents: minimum('maxSubagents'),
    subagents: maximum('subagents'),
    maxChildDepth: minimum('maxChildDepth'),
    childDepth: maximum('childDepth'),
    deadlineAt: minimum('deadlineAt'),
    startedAt: Math.min(Date.now(), previous?.startedAt ?? Number.POSITIVE_INFINITY),
  };
}

export function validateBudget(budget: TaskExecutionRecord['budget'], requireRemainingTime = false): void {
  const nonNegative = ['toolCalls', 'subagents', 'childDepth'] as const;
  const optionalNonNegative = ['maxToolCalls', 'maxSubagents', 'maxChildDepth'] as const;
  for (const key of nonNegative) if (!Number.isFinite(budget[key]) || budget[key] < 0) throw new Error(`Invalid task execution budget: ${key}.`);
  for (const key of optionalNonNegative) if (budget[key] !== undefined && (!Number.isFinite(budget[key]) || budget[key]! < 0)) throw new Error(`Invalid task execution budget: ${key}.`);
  if (budget.maxToolCalls !== undefined && budget.toolCalls > budget.maxToolCalls) throw new Error(`Task execution tool-call budget is already exhausted. consumed=${budget.toolCalls}; cumulativeMax=${budget.maxToolCalls}. This cap includes prior Task generations, not additional allowance; preserve consumption, existing ceilings and deadline when checking a corrected request.`);
  if (budget.maxSubagents !== undefined && budget.subagents > budget.maxSubagents) throw new Error(`Task execution subagent budget is already exhausted. consumed=${budget.subagents}; cumulativeMax=${budget.maxSubagents}. This cap includes prior Task generations, not additional allowance; preserve consumption, existing ceilings and deadline when checking a corrected request.`);
  if (budget.maxChildDepth !== undefined && budget.childDepth > budget.maxChildDepth) throw new Error('Task execution child-depth budget is exceeded.');
  if (!Number.isFinite(budget.startedAt) || (budget.deadlineAt !== undefined && (!Number.isFinite(budget.deadlineAt) || budget.deadlineAt < 0))) throw new Error('Task execution deadline is invalid.');
  // A running execution may report its final usage after its deadline. The
  // deadline still bars starting a new execution, but must not prevent the
  // expired execution from recording consumption and settling its result.
  if (requireRemainingTime && budget.deadlineAt !== undefined && budget.deadlineAt <= Date.now()) throw new Error('Task execution deadline is expired.');
}

export function validateRootBudget(budget: TaskRootBudgetRecord): void {
  const values = [budget.toolCalls, budget.subagents, budget.maxToolCalls, budget.maxSubagents,
    budget.maxChildDepth, budget.deadlineAt, budget.startedAt, budget.updatedAt];
  if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Invalid root Task budget.');
  if (budget.toolCalls > budget.maxToolCalls || budget.subagents > budget.maxSubagents) {
    throw new Error('Root Task budget is exhausted.');
  }
}
