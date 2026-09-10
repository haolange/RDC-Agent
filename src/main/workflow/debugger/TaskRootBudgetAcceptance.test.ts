import { expect, it } from 'vitest';
import { MemoryTaskStore, TaskRegistry } from '../../agent-runtime/tasks';
import { flushPolicyBudgetObservers } from './DelegationBudget';
import { bindTaskRootBudget } from './TaskRootBudget';
import { createPolicyBudgetState } from './TurnCoordinator';
const policy = () => createPolicyBudgetState({ maxToolCalls: 10, maxSubagents: 4, maxChildDepth: 3, maxWallTimeMs: 60000 });
it('rejects switching a bound live ledger to another root and preserves both ledgers and observer ownership', async () => {
 const registry = new TaskRegistry(new MemoryTaskStore());
 const original = policy(); original.toolCalls = 2;
 await bindTaskRootBudget(registry, 'owner', original, 'root-B');
 const live = policy(); live.toolCalls = 1;
 await bindTaskRootBudget(registry, 'owner', live, 'root-A');
 await expect(bindTaskRootBudget(registry, 'owner', live, 'root-B')).rejects.toThrow('TASK_ROOT_BUDGET_REBIND_DENIED');
 expect(live.toolCalls).toBe(1);
 expect((await registry.getRootBudget('root-A'))?.toolCalls).toBe(1);
 expect((await registry.getRootBudget('root-B'))?.toolCalls).toBe(2);
 live.toolCalls += 1; await flushPolicyBudgetObservers(live);
 expect((await registry.getRootBudget('root-B'))?.toolCalls).toBe(2);
 expect((await registry.getRootBudget('root-A'))?.toolCalls).toBe(2);
});
it('merges a fresh live ledger into an existing root once during concurrent initial binds', async () => {
 const registry = new TaskRegistry(new MemoryTaskStore());
 const original = policy(); original.toolCalls = 2;
 await bindTaskRootBudget(registry, 'owner', original, 'root-existing');
 const live = policy(); live.toolCalls = 1;
 await Promise.all([
  bindTaskRootBudget(registry, 'owner', live, 'root-existing'),
  bindTaskRootBudget(registry, 'owner', live, 'root-existing'),
 ]);
 expect(live.toolCalls).toBe(3);
 expect((await registry.getRootBudget('root-existing'))?.toolCalls).toBe(3);
});
