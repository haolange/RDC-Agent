import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryTaskStore, TaskRegistry } from '../../agent-runtime/tasks';
import { createTaskRuntimeTools } from './TaskRuntimeTools';
import { bindTaskRootBudget } from './TaskRootBudget';
import { createPolicyBudgetState, TurnHandle } from './TurnCoordinator';

const state = vi.hoisted(() => ({ store: null as unknown as MemoryTaskStore }));
vi.mock('../../agent-runtime/tasks', async importOriginal => ({
  ...await importOriginal<typeof import('../../agent-runtime/tasks')>(),
  createSessionTaskStore: () => state.store,
  getDelegatedTaskScope: () => null,
}));
vi.mock('../../agent-trace/TraceProjectionRefreshService', () => ({ traceProjectionRefreshService: { schedule: vi.fn() } }));
vi.mock('../../sessions/SessionArtifactResolver', () => ({ sessionArtifactResolver: { read: vi.fn() } }));

const policy = (toolCalls = 1, maxToolCalls = 100) => {
  const value = createPolicyBudgetState({ maxToolCalls, maxSubagents: 5, maxChildDepth: 3, maxWallTimeMs: 600_000 });
  value.toolCalls = toolCalls;
  return value;
};

beforeEach(() => { state.store = new MemoryTaskStore(); vi.clearAllMocks(); });

function runtimeUpdate(budget: ReturnType<typeof policy>, turnId = 'new-turn') {
  const turn = { policyBudget: budget, subagentBudget: { depth: 0 }, turnId, generation: 1 } as unknown as TurnHandle;
  return createTaskRuntimeTools({ sessionId: 'owner', turnHandle: turn, getActiveTurn: () => turn })
    .find(tool => tool.name === 'task_update')!;
}

async function historicalDirect(registry: TaskRegistry, rootBudgetId: string, calls = 3, cap = 10) {
  const budget = policy(calls, cap);
  await bindTaskRootBudget(registry, 'owner', budget, rootBudgetId);
  const [task] = await registry.createTasks([{ subject: `Historical ${rootBudgetId}` }]);
  const execution = await registry.startExecution(task!.id, { mode: 'direct', rootBudgetId,
    budget: { toolCalls: calls, maxToolCalls: cap, deadlineAt: budget.wallStartedAt + budget.maxWallTimeMs } });
  await registry.settleExecution(execution.id, { expectedGeneration: execution.generation, status: 'blocked',
    result: { disposition: 'blocked', summary: 'Historical result retained', outputs: {} } });
  return task!;
}

describe('direct Task runtime root selection', () => {
  it('resumes the cancelled goal through a fresh owning turn while charging the existing root', async () => {
    const registry = new TaskRegistry(state.store);
    const task = await registry.createTask('Continue stopped work');
    await runtimeUpdate(policy(5), 'first-turn').execute('first', { taskId: task.id, status: 'in_progress' });
    await registry.cancelTask(task.id);
    const [old] = await registry.listExecutions(task.id);
    const root = await registry.getRootBudget(old!.rootBudgetId!);
    const live = policy(1);
    await runtimeUpdate(live, 'later-turn').execute('resume', { taskId: task.id, status: 'in_progress', resumeCancelled: true });
    const executions = await registry.listExecutions(task.id);
    expect(executions[0]).toEqual(old);
    expect(executions[1]).toMatchObject({ generation: 2, rootBudgetId: old!.rootBudgetId,
      budget: { toolCalls: 6, maxToolCalls: 100, startedAt: old!.budget.startedAt } });
    expect(live.toolCalls).toBe(6);
    expect(live.wallStartedAt + live.maxWallTimeMs).toBeLessThanOrEqual(root!.deadlineAt);
    expect(await registry.listTasks()).toHaveLength(1);
  });

  it('keeps the original root when explicitly resuming a cancelled delegated Task as direct work', async () => {
    const registry = new TaskRegistry(state.store, { onCancelExecution: async () => undefined });
    const inherited = policy(7, 16);
    await bindTaskRootBudget(registry, 'owner', inherited, 'delegated-root');
    const task = await registry.createTask('Continue an originally delegated goal');
    await registry.startExecution(task.id, { mode: 'subagent', rootBudgetId: 'delegated-root',
      frozenPlanRef: 'turn:old-child:generation:1',
      budget: { toolCalls: 5, maxToolCalls: 12, deadlineAt: inherited.wallStartedAt + inherited.maxWallTimeMs } });
    await registry.cancelTask(task.id);
    const old = (await registry.listExecutions(task.id))[0]!;
    const root = await registry.getRootBudget('delegated-root');
    const live = policy(1, 100);
    await runtimeUpdate(live).execute('resume-delegated', { taskId: task.id, status: 'in_progress', resumeCancelled: true });
    const current = (await registry.listExecutions(task.id)).at(-1)!;
    expect(current).toMatchObject({ generation: 2, mode: 'direct', rootBudgetId: 'delegated-root',
      budget: { toolCalls: 8, maxToolCalls: 12, startedAt: old.budget.startedAt } });
    expect(live.toolCalls).toBe(8);
    expect(live.maxToolCalls).toBe(16);
    expect(live.wallStartedAt + live.maxWallTimeMs).toBeLessThanOrEqual(root!.deadlineAt);
    expect(await registry.getExecution(old.id)).toEqual(old);
  });
  it('wires task_get to the actual active ledger after starting the owned Task', async () => {
    const registry = new TaskRegistry(state.store);
    const [task] = await registry.createTasks([{ subject: 'Budget preflight' }]);
    const live = policy(2);
    const turn = new TurnHandle({ sessionKey: 'owner', turnId: 'budget-turn', generation: 1, policyBudget: live });
    try {
      const tools = createTaskRuntimeTools({ sessionId: 'owner', turnHandle: turn, getActiveTurn: () => turn });
      await tools.find(tool => tool.name === 'task_update')!.execute('start', { taskId: task!.id, status: 'in_progress' });
      const before = await registry.getRootBudget((await registry.listExecutions(task!.id))[0]!.rootBudgetId!);
      const result = await tools.find(tool => tool.name === 'task_get')!.execute('preflight', { taskId: task!.id });
      const first = result.content[0];
      const snapshot = JSON.parse(first?.type === 'text' ? first.text : '{}').budgetSnapshot;
      expect(snapshot).toMatchObject({ isReservation: false, root: { toolCalls: 2 },
        live: { turnId: 'budget-turn', generation: 1, remainingPolicy: { toolCalls: 98 } } });
      expect(await registry.getRootBudget(before!.id)).toEqual(before);
    } finally { turn.close(); }
  });

  it('starts a new successor under the live root established by its completed delegated dependency', async () => {
    const registry = new TaskRegistry(state.store);
    const old = await historicalDirect(registry, 'old-root');
    const oldBudget = await registry.getRootBudget('old-root');
    const live = policy(5);
    await bindTaskRootBudget(registry, 'owner', live, 'current-root');
    const [review] = await registry.createTasks([{ subject: 'New artifact review', parentTaskId: old.id }]);
    const execution = await registry.startExecution(review!.id, { mode: 'subagent', rootBudgetId: 'current-root',
      budget: { toolCalls: 0, maxToolCalls: 80, deadlineAt: live.wallStartedAt + live.maxWallTimeMs } });
    await registry.settleExecution(execution.id, { expectedGeneration: execution.generation, status: 'completed',
      result: { disposition: 'completed', summary: 'New review completed', outputs: {} } });
    const [next] = await registry.createTasks([{ subject: 'New evidence decision', parentTaskId: old.id, blockedBy: [review!.id] }]);
    await runtimeUpdate(live).execute('start-next', { taskId: next!.id, status: 'in_progress' });
    expect(await registry.listExecutions(next!.id)).toEqual([expect.objectContaining({ rootBudgetId: 'current-root', generation: 1 })]);
    expect(await registry.getRootBudget('old-root')).toEqual(oldBudget);
    expect((await registry.getRootBudget('current-root'))?.toolCalls).toBe(5);
    expect(await registry.listExecutions(old.id)).toHaveLength(1);
  });

  it('does not hydrate an unrelated historical root for the first direct Task in a fresh turn', async () => {
    const registry = new TaskRegistry(state.store);
    await historicalDirect(registry, 'unrelated-root');
    const before = await registry.getRootBudget('unrelated-root');
    const [task] = await registry.createTasks([{ subject: 'Independent new scope' }]);
    const live = policy(2);
    await runtimeUpdate(live).execute('start', { taskId: task!.id, status: 'in_progress' });
    const [execution] = await registry.listExecutions(task!.id);
    expect(execution?.rootBudgetId).not.toBe('unrelated-root');
    expect(execution?.budget.toolCalls).toBe(2);
    expect(execution?.budget.maxToolCalls).toBe(100);
    expect(await registry.getRootBudget('unrelated-root')).toEqual(before);
  });

  it('restores only the retried Tasks own budget despite a more recent unrelated direct execution', async () => {
    const registry = new TaskRegistry(state.store);
    const retried = await historicalDirect(registry, 'retry-root', 3, 10);
    const original = await registry.getRootBudget('retry-root');
    await historicalDirect(registry, 'other-root', 9, 20);
    const unrelated = await registry.getRootBudget('other-root');
    const live = policy(1);
    await runtimeUpdate(live).execute('retry', { taskId: retried.id, status: 'in_progress' });
    const executions = await registry.listExecutions(retried.id);
    expect(executions).toHaveLength(2);
    expect(executions.at(-1)).toMatchObject({ rootBudgetId: 'retry-root', generation: 2,
      budget: { toolCalls: 4, maxToolCalls: 10 } });
    expect(live.toolCalls).toBe(4);
    expect(live.maxToolCalls).toBe(10);
    expect(live.wallStartedAt + live.maxWallTimeMs).toBeLessThanOrEqual(original!.deadlineAt);
    expect(await registry.getRootBudget('other-root')).toEqual(unrelated);
  });

  it('still refuses retrying an old root inside a live ledger already bound to another root', async () => {
    const registry = new TaskRegistry(state.store);
    const old = await historicalDirect(registry, 'old-root');
    const oldBudget = await registry.getRootBudget('old-root');
    const live = policy(5);
    await bindTaskRootBudget(registry, 'owner', live, 'current-root');
    const currentBudget = await registry.getRootBudget('current-root');
    await expect(runtimeUpdate(live).execute('denied', { taskId: old.id, status: 'in_progress' }))
      .rejects.toThrow('TASK_ROOT_BUDGET_REBIND_DENIED');
    expect(await registry.listExecutions(old.id)).toHaveLength(1);
    expect(await registry.getRootBudget('old-root')).toEqual(oldBudget);
    expect(await registry.getRootBudget('current-root')).toEqual(currentBudget);
  });
});
