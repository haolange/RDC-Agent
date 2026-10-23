import { describe, expect, it, vi } from 'vitest';
import { MemoryTaskStore } from './TaskStore';
import { TaskRegistry } from './TaskRegistry';
import { createTaskGetTool } from './TaskTools';

function body(result: Awaited<ReturnType<ReturnType<typeof createTaskGetTool>['execute']>>) {
  const first = result.content[0];
  return JSON.parse(first?.type === 'text' ? first.text : '{}');
}

async function fixture() {
  const store = new MemoryTaskStore();
  const registry = new TaskRegistry(store);
  const now = Date.now();
  await registry.updateRootBudget('root-a', { toolCalls: 11, subagents: 1, maxToolCalls: 30,
    maxSubagents: 4, maxChildDepth: 3, startedAt: now, deadlineAt: now + 60_000 });
  const [task] = await registry.createTasks([{ subject: 'Current investigation' }]);
  const execution = await registry.startExecution(task!.id, { mode: 'direct', rootBudgetId: 'root-a',
    budget: { toolCalls: 3, maxToolCalls: 30 } });
  return { store, registry, task: task!, execution };
}

describe('task_get budget observation', () => {
  it('exposes request attempt accounting even before a Task execution starts, without inventing capacity', async () => {
    const registry = new TaskRegistry(new MemoryTaskStore());
    const [task] = await registry.createTasks([{ subject: 'Preflight' }]);
    const usage = { observedAt: Date.now(), isReservation: false as const,
      source: 'committed-request-snapshots' as const, scopeId: 'session-a', committedRequests: 4, scopes: [] };
    const readRequestUsage = vi.fn(() => usage);
    const result = body(await createTaskGetTool(registry, { readRequestUsage }).execute('read', { taskId: task!.id }));
    expect(result.requestUsage).toEqual(usage);
    expect(result.budgetSnapshot).toMatchObject({ unavailableReason: 'no-execution', live: null });
    expect(readRequestUsage).toHaveBeenCalledOnce();
    const unavailable = body(await createTaskGetTool(registry).execute('read', { taskId: task!.id }));
    expect(unavailable.requestUsage).toBeNull();
  });

  it('keeps Task fields and exposes durable accounting without reserving or changing it', async () => {
    const { registry, task, execution } = await fixture();
    const beforeTask = await registry.getTask(task.id);
    const beforeExecution = await registry.getExecution(execution.id);
    const beforeRoot = await registry.getRootBudget('root-a');
    const result = body(await createTaskGetTool(registry).execute('read', { taskId: task.id }));
    expect(result).toMatchObject({ id: task.id, subject: task.subject,
      budgetSnapshot: { isReservation: false, unavailableReason: null,
        execution: { id: execution.id, generation: 1, mode: 'direct', budget: { toolCalls: 3 } },
        root: { id: 'root-a', toolCalls: 11, maxToolCalls: 30 },
        rootRemaining: { toolCalls: 19, subagents: 3 }, live: null } });
    expect(result.budgetSnapshot.rootRemaining.wallTimeMs).toBeGreaterThan(0);
    expect(result.budgetSnapshot.observedAt).toBeGreaterThanOrEqual(beforeRoot!.updatedAt);
    expect(await registry.getTask(task.id)).toEqual(beforeTask);
    expect(await registry.getExecution(execution.id)).toEqual(beforeExecution);
    expect(await registry.getRootBudget('root-a')).toEqual(beforeRoot);
  });

  it('reads updated root consumption instead of presenting a stale execution counter as remaining capacity', async () => {
    const { registry, task } = await fixture();
    await registry.updateRootBudget('root-a', { ...(await registry.getRootBudget('root-a'))!, toolCalls: 29, subagents: 3 });
    const result = body(await createTaskGetTool(registry).execute('read', { taskId: task.id }));
    expect(result.budgetSnapshot.rootRemaining).toMatchObject({ toolCalls: 1, subagents: 1 });
    expect(result.budgetSnapshot.execution.budget.toolCalls).toBe(3);
  });

  it('keeps an unstarted Task budget unknown rather than inventing zero or unlimited resources', async () => {
    const registry = new TaskRegistry(new MemoryTaskStore());
    const [task] = await registry.createTasks([{ subject: 'Not started' }]);
    const result = body(await createTaskGetTool(registry).execute('read', { taskId: task!.id }));
    expect(result.budgetSnapshot).toMatchObject({ unavailableReason: 'no-execution', execution: null,
      root: null, rootRemaining: null, live: null, isReservation: false });
  });

  it('reports a missing durable root explicitly and does not rebind or create one while reading', async () => {
    const { store, registry, task, execution } = await fixture();
    await store.saveExecution({ ...execution, rootBudgetId: 'missing-root' });
    const result = body(await createTaskGetTool(registry).execute('read', { taskId: task.id }));
    expect(result.budgetSnapshot).toMatchObject({ unavailableReason: 'root-missing', root: null, rootRemaining: null });
    expect(await registry.getRootBudget('missing-root')).toBeNull();
  });

  it('does not attach current-turn resources to a settled historical execution', async () => {
    const { registry, task, execution } = await fixture();
    await registry.settleExecution(execution.id, { expectedGeneration: 1, status: 'blocked',
      result: { disposition: 'blocked', summary: 'Checkpoint preserved', outputs: {} } });
    const readLiveBudget = vi.fn();
    const result = body(await createTaskGetTool(registry, { readLiveBudget }).execute('read', { taskId: task.id }));
    expect(result.budgetSnapshot.live).toBeNull();
    expect(result.budgetSnapshot.execution.status).toBe('blocked');
    expect(readLiveBudget).not.toHaveBeenCalled();
  });

  it('returns the active policy view separately from broader persisted root capacity', async () => {
    const { registry, task } = await fixture();
    const live = { turnId: 'active-turn', generation: 2, policyChain: [],
      remainingPolicy: { toolCalls: 4, subagents: 0, wallTimeMs: 1000 }, reservedSubagentSlots: 0,
      subagentTreeAdmission: { allowed: true, reason: null, childrenSpawned: 0, activeChildren: 0 } };
    const readLiveBudget = vi.fn(() => live);
    const result = body(await createTaskGetTool(registry, { readLiveBudget }).execute('read', { taskId: task.id }));
    expect(readLiveBudget).toHaveBeenCalledExactlyOnceWith('root-a');
    expect(result.budgetSnapshot.live).toEqual(live);
    expect(result.budgetSnapshot.rootRemaining.toolCalls).toBe(19);
    expect(result.budgetSnapshot.live.remainingPolicy.toolCalls).toBe(4);
  });

  it('does not treat an execution without a root binding as an unlimited budget', async () => {
    const registry = new TaskRegistry(new MemoryTaskStore());
    const [task] = await registry.createTasks([{ subject: 'Unbound' }]);
    await registry.startExecution(task!.id, { mode: 'direct' });
    const result = body(await createTaskGetTool(registry).execute('read', { taskId: task!.id }));
    expect(result.budgetSnapshot).toMatchObject({ unavailableReason: 'root-unbound', root: null, rootRemaining: null, live: null });
  });

  it('rejects a Task linked to another Tasks execution instead of disclosing its budget', async () => {
    const { store, registry, task } = await fixture();
    const [other] = await registry.createTasks([{ subject: 'Another scope' }]);
    const foreign = await registry.startExecution(other!.id, { mode: 'direct', rootBudgetId: 'root-a' });
    await store.saveTask({ ...(await registry.getTask(task.id))!, currentExecutionId: foreign.id });
    await expect(createTaskGetTool(registry).execute('read', { taskId: task.id }))
      .rejects.toThrow('TASK_BUDGET_EXECUTION_MISMATCH');
  });

  it('keeps delegated Task visibility restrictions ahead of any live-budget read', async () => {
    const { registry, task } = await fixture();
    const [other] = await registry.createTasks([{ subject: 'Foreign Task' }]);
    const readLiveBudget = vi.fn();
    const readRequestUsage = vi.fn();
    await expect(createTaskGetTool(registry, { scopeRootTaskId: task.id, readLiveBudget, readRequestUsage })
      .execute('read', { taskId: other!.id })).rejects.toThrow();
    expect(readLiveBudget).not.toHaveBeenCalled();
    expect(readRequestUsage).not.toHaveBeenCalled();
  });

  it.each(['execution', 'root'] as const)('rejects a corrupted %s identity rather than relabeling its accounting', async kind => {
    const { registry, task, execution } = await fixture();
    if (kind === 'execution') vi.spyOn(registry, 'getExecution').mockResolvedValue({ ...execution, id: 'wrong-id' });
    else vi.spyOn(registry, 'getRootBudget').mockResolvedValue({ ...(await registry.getRootBudget('root-a'))!, id: 'wrong-id' });
    await expect(createTaskGetTool(registry).execute('read', { taskId: task.id }))
      .rejects.toThrow(kind === 'execution' ? 'TASK_BUDGET_EXECUTION_MISMATCH' : 'TASK_BUDGET_ROOT_ID_MISMATCH');
  });

  it('reports an expired root as zero remaining wall time without extending its deadline', async () => {
    const { registry, task } = await fixture();
    const before = await registry.getRootBudget('root-a');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(before!.deadlineAt + 1000);
    try {
      const result = body(await createTaskGetTool(registry).execute('read', { taskId: task.id }));
      expect(result.budgetSnapshot.rootRemaining.wallTimeMs).toBe(0);
      expect(await registry.getRootBudget('root-a')).toEqual(before);
    } finally { clock.mockRestore(); }
  });
});
