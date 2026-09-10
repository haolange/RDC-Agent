import { describe, expect, it } from 'vitest';
import { MemoryTaskStore, TaskRegistry } from '../../agent-runtime/tasks';
import { deriveChildPolicyBudget } from './DelegationBudget';
import { bindTaskRootBudget } from './TaskRootBudget';
import { createPolicyBudgetState } from './TurnCoordinator';

describe('Task root budget binding', () => {
  it('persists the actual root ledger without narrowing it to a child Capsule', async () => {
    const registry = new TaskRegistry(new MemoryTaskStore());
    const parent = createPolicyBudgetState({
      maxToolCalls: 10,
      maxSubagents: 4,
      maxChildDepth: 3,
      maxWallTimeMs: 60_000,
    });
    parent.toolCalls = 3;
    const child = deriveChildPolicyBudget(parent, {
      maxToolCalls: 1,
      maxSubagents: 0,
      maxWallTimeMs: 1_000,
    });
    const id = await bindTaskRootBudget(registry, 'owner', child);
    await expect(registry.getRootBudget(id)).resolves.toMatchObject({
      toolCalls: 3,
      maxToolCalls: 10,
      maxSubagents: 4,
      maxChildDepth: 3,
    });
  });

  it('restores an existing root id and never refreshes its counters or deadline', async () => {
    const registry = new TaskRegistry(new MemoryTaskStore());
    const original = createPolicyBudgetState({ maxToolCalls: 8, maxSubagents: 3, maxChildDepth: 3, maxWallTimeMs: 60_000 });
    original.toolCalls = 5;
    const id = await bindTaskRootBudget(registry, 'owner', original);
    const retry = createPolicyBudgetState({ maxToolCalls: 20, maxSubagents: 10, maxChildDepth: 5, maxWallTimeMs: 120_000 });
    retry.toolCalls = 1;
    await bindTaskRootBudget(registry, 'owner', retry, id);
    expect(retry.toolCalls).toBe(6);
    await bindTaskRootBudget(registry, 'owner', retry, id);
    expect(retry.toolCalls).toBe(6);
    await expect(registry.getRootBudget(id)).resolves.toMatchObject({ toolCalls: 6, maxToolCalls: 8, maxSubagents: 3 });
  });

  it('rejects rebinding one live policy ledger to a different durable root', async () => {
    const registry = new TaskRegistry(new MemoryTaskStore());
    const live = createPolicyBudgetState({ maxToolCalls: 8, maxSubagents: 3, maxChildDepth: 3, maxWallTimeMs: 60_000 });
    await bindTaskRootBudget(registry, 'owner', live, 'root-a');
    await registry.updateRootBudget('root-b', {
      toolCalls: 2, subagents: 0, maxToolCalls: 8, maxSubagents: 3,
      maxChildDepth: 3, deadlineAt: live.wallStartedAt + 60_000, startedAt: live.wallStartedAt,
    });
    await expect(bindTaskRootBudget(registry, 'owner', live, 'root-b')).rejects.toThrow(/REBIND_DENIED/);
    expect((await registry.getRootBudget('root-a'))?.toolCalls).toBe(0);
  });
});
