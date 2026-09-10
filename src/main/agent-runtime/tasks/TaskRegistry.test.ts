import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskRegistry } from './TaskRegistry';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function createRegistry(): Promise<TaskRegistry> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-tasks-'));
  roots.push(dir);
  return new TaskRegistry(dir);
}

describe('TaskRegistry', () => {
  it('supports create / get / list / update CRUD', async () => {
    const registry = await createRegistry();
    const created = await registry.createTask('Implement login', {
      description: 'Wire auth endpoints',
      executionRequired: false,
    });
    expect(created.id).toMatch(/^task_/);
    expect(created.status).toBe('pending');
    expect(created.subject).toBe('Implement login');

    const loaded = await registry.getTask(created.id);
    expect(loaded).toMatchObject({ id: created.id, subject: 'Implement login' });

    const updated = await registry.updateTask(created.id, {
      status: 'in_progress',
      subject: 'Implement login API',
    });
    expect(updated.status).toBe('in_progress');
    expect(updated.subject).toBe('Implement login API');

    const listed = await registry.listTasks();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
  });

  it('allows independent parallel executions and requires a blocked reason', async () => {
    const registry = await createRegistry();
    const first = await registry.createTask('First');
    const second = await registry.createTask('Second');
    const third = await registry.createTask('Third');

    const firstRun = await registry.startExecution(first.id, { mode: 'subagent' });
    const secondRun = await registry.startExecution(second.id, { mode: 'subagent' });
    expect(firstRun.status).toBe('running');
    expect(secondRun.status).toBe('running');
    await expect(registry.updateTask(third.id, { status: 'blocked' })).rejects.toThrow(/statusReason/);

    const blocked = await registry.updateTask(third.id, {
      status: 'blocked',
      statusReason: 'Waiting for a capture.',
    });
    expect(blocked.statusReason).toBe('Waiting for a capture.');

    const cancelled = await registry.updateTask(third.id, { status: 'cancelled' });
    expect(cancelled.statusReason).toBe('Cancelled by task owner.');
  });
  it('maintains bidirectional blockedBy / blocks links', async () => {
    const registry = await createRegistry();
    const upstream = await registry.createTask('Upstream');
    const downstream = await registry.createTask('Downstream', {
      blockedBy: [upstream.id],
    });

    const refreshedUpstream = await registry.getTask(upstream.id);
    expect(downstream.blockedBy).toEqual([upstream.id]);
    expect(refreshedUpstream?.blocks).toEqual([downstream.id]);
  });

  it('unlocks pending dependents when blocker completes', async () => {
    const registry = await createRegistry();
    const a = await registry.createTask('A');
    const b = await registry.createTask('B', { blockedBy: [a.id] });

    expect(await registry.canStart(b.id)).toBe(false);
    const execution = await registry.startExecution(a.id, { mode: 'direct' });
    await registry.settleExecution(execution.id, {
      status: 'completed',
      expectedGeneration: execution.generation,
      result: { disposition: 'completed', summary: 'Done', outputs: {} },
    });
    expect(await registry.canStart(b.id)).toBe(true);

    const unblocked = await registry.getUnblockedTasks(a.id);
    expect(unblocked.map((task) => task.id)).toEqual([b.id]);
  });

  it('rejects dependency cycles on update addBlockedBy', async () => {
    const registry = await createRegistry();
    const a = await registry.createTask('A');
    const b = await registry.createTask('B', { blockedBy: [a.id] });

    await expect(registry.updateTask(a.id, { addBlockedBy: [b.id] })).rejects.toThrow(/dependency cycle/);
  });

  it('rejects self-dependency cycles', async () => {
    const registry = await createRegistry();
    const a = await registry.createTask('A');
    await expect(registry.updateTask(a.id, { addBlockedBy: [a.id] })).rejects.toThrow(/cannot depend on itself/);
  });

  it('rejects cycles introduced via addBlocks', async () => {
    const registry = await createRegistry();
    const a = await registry.createTask('A');
    const b = await registry.createTask('B', { blockedBy: [a.id] });

    await expect(registry.updateTask(b.id, { addBlocks: [a.id] })).rejects.toThrow(/dependency cycle/);
  });

  it('rejects empty subject', async () => {
    const registry = await createRegistry();
    await expect(registry.createTask('   ')).rejects.toThrow(/subject/);
  });

  it('creates a batch in one persist pass and emits one change event', async () => {
    const registry = await createRegistry();
    const events: string[] = [];
    registry.onTaskChange = ({ type, task }) => {
      events.push(`${type}:${task.subject}`);
    };
    const created = await registry.createTasks([
      { subject: 'First' },
      { subject: 'Second' },
      { subject: 'Third' },
    ]);
    expect(created.map((task) => task.subject)).toEqual(['First', 'Second', 'Third']);
    expect(events).toEqual(['created:Third']);
    expect((await registry.listTasks()).map((task) => task.subject)).toEqual(['First', 'Second', 'Third']);
  });

  it('requires dependencies to exist and rejects starting before verified completion', async () => {
    const registry = await createRegistry();
    await expect(registry.createTask('Broken', { blockedBy: ['task_missing'] })).rejects.toThrow(/dependency not found/);
    const parent = await registry.createTask('Parent');
    const child = await registry.createTask('Child', { blockedBy: [parent.id] });
    await expect(registry.startExecution(child.id, { mode: 'subagent' })).rejects.toThrow(/dependencies/);
  });

  it('persists execution generations, result requirements, and rejects stale results', async () => {
    const registry = await createRegistry();
    const task = await registry.createTask('Produce evidence', { completionRequirements: ['report'] });
    const first = await registry.startExecution(task.id, {
      mode: 'subagent',
      budget: { maxToolCalls: 5, toolCalls: 2 },
    });
    await expect(registry.settleExecution(first.id, {
      status: 'completed', expectedGeneration: first.generation,
      result: { disposition: 'completed', summary: 'Missing output', outputs: {} },
    })).rejects.toThrow(/missing requirements/);
    await registry.settleExecution(first.id, {
      status: 'blocked', expectedGeneration: first.generation,
      result: { disposition: 'blocked', summary: 'Need another run', outputs: {} },
    });
    const second = await registry.startExecution(task.id, {
      mode: 'subagent', budget: { maxToolCalls: 10, toolCalls: 0 },
    });
    expect(second.generation).toBe(2);
    expect(second.budget).toMatchObject({ maxToolCalls: 5, toolCalls: 2 });
    await expect(registry.appendExecutionMessage(first.id, {
      expectedGeneration: first.generation, kind: 'result', direction: 'to_parent', body: 'late',
    })).rejects.toThrow(/Stale/);
    await registry.settleExecution(second.id, {
      status: 'completed', expectedGeneration: second.generation,
      result: { disposition: 'completed', summary: 'Verified', outputs: { report: 'artifact://report' } },
    });
    await expect(registry.getTask(task.id)).resolves.toMatchObject({ status: 'completed', disposition: 'completed' });
  });

  it('queues generation-bound messages with a durable cursor', async () => {
    const registry = await createRegistry();
    const task = await registry.createTask('Background work');
    const execution = await registry.startExecution(task.id, { mode: 'subagent' });
    await registry.appendExecutionMessage(execution.id, { expectedGeneration: execution.generation, kind: 'progress', direction: 'to_parent', body: 'first' });
    await registry.appendExecutionMessage(execution.id, { expectedGeneration: execution.generation, kind: 'decision_required', direction: 'to_child', body: 'second' });
    const firstPage = await registry.consumeExecutionMessages(execution.id, 0);
    expect(firstPage.messages.map((message) => message.body)).toEqual(['first', 'second']);
    expect(firstPage.cursor).toBe(2);
    await expect(registry.consumeExecutionMessages(execution.id, firstPage.cursor)).resolves.toEqual({ messages: [], cursor: 2 });
    await registry.ackExecutionMessages(execution.id, { expectedGeneration: execution.generation, direction: 'to_child', throughSequence: 2 });
    await registry.ackExecutionMessages(execution.id, { expectedGeneration: execution.generation, direction: 'to_parent', throughSequence: 1 });
    await expect(registry.getExecution(execution.id)).resolves.toMatchObject({ childMessageAckSequence: 2, parentMessageAckSequence: 1 });
    await expect(registry.ackExecutionMessages(execution.id, { expectedGeneration: execution.generation, direction: 'to_child', throughSequence: 1 })).rejects.toThrow(/monotonic/);
  });

  it('binds a frozen request reference once and accepts an exact retry', async () => {
    const registry = await createRegistry();
    const task = await registry.createTask('request binding');
    const execution = await registry.startExecution(task.id, { mode: 'subagent' });
    await registry.bindExecutionPlanRef(execution.id, { expectedGeneration: 1, frozenPlanRef: 'request://sha256/one' });
    await expect(registry.bindExecutionPlanRef(execution.id, { expectedGeneration: 1, frozenPlanRef: 'request://sha256/one' })).resolves.toMatchObject({ frozenPlanRef: 'request://sha256/one' });
    await expect(registry.bindExecutionPlanRef(execution.id, { expectedGeneration: 1, frozenPlanRef: 'request://sha256/two' })).rejects.toThrow(/already bound/);
  });

  it('cancels the owned execution before terminalizing its task', async () => {
    const cancelled: string[] = [];
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-tasks-'));
    roots.push(dir);
    const registry = new TaskRegistry(dir, { onCancelExecution: async (execution) => { cancelled.push(execution.id); } });
    const task = await registry.createTask('Cancelable');
    const execution = await registry.startExecution(task.id, { mode: 'subagent' });
    await registry.updateTask(task.id, { status: 'cancelled' });
    expect(cancelled).toEqual([execution.id]);
    await expect(registry.getExecution(execution.id)).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('does not bypass child closure or a running execution through direct completion updates', async () => {
    const registry = await createRegistry();
    const parent = await registry.createTask('Parent');
    const execution = await registry.startExecution(parent.id, { mode: 'direct' });
    await registry.createTask('Child', { parentTaskId: parent.id });
    const result = { disposition: 'completed' as const, summary: 'Claimed done', outputs: {} };
    await expect(registry.updateTask(parent.id, { status: 'completed', result })).rejects.toThrow(/has not settled/);
    await expect(registry.settleExecution(execution.id, {
      status: 'completed', expectedGeneration: execution.generation, result,
    })).rejects.toThrow(/unresolved child/);
  });

  it('makes exact settlement idempotent and rejects conflicting settlement or revival', async () => {
    const registry = await createRegistry();
    const task = await registry.createTask('Settle once');
    const execution = await registry.startExecution(task.id, { mode: 'direct', budget: { toolCalls: 4 } });
    const settlement = { status: 'completed' as const, expectedGeneration: execution.generation, result: { disposition: 'completed' as const, summary: 'Done', outputs: {} } };
    const first = await registry.settleExecution(execution.id, settlement);
    await expect(registry.settleExecution(execution.id, settlement)).resolves.toEqual(first);
    await expect(registry.settleExecution(execution.id, { ...settlement, result: { ...settlement.result, summary: 'Changed' } })).rejects.toThrow(/different terminal result/);
    await expect(registry.updateExecutionStatus(execution.id, 'running', execution.generation)).rejects.toThrow(/cannot return/);
  });

  it('keeps budget monotonic and enforces status/disposition pairs', async () => {
    const registry = await createRegistry();
    const task = await registry.createTask('Strict result');
    const execution = await registry.startExecution(task.id, { mode: 'direct', budget: { toolCalls: 10 } });
    await expect(registry.settleExecution(execution.id, {
      status: 'failed', expectedGeneration: execution.generation,
      result: { disposition: 'completed', summary: 'False success', outputs: {} },
    })).rejects.toThrow(/requires blocked disposition/);
    await expect(registry.updateExecutionBudget(execution.id, { expectedGeneration: execution.generation, toolCalls: 9 })).rejects.toThrow(/monotonic/);
  });

  it('runs cancellation callback outside the state lock and prevents producer settlement', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-tasks-'));
    roots.push(dir);
    let registry!: TaskRegistry;
    let settlementRejected = false;
    registry = new TaskRegistry(dir, { onCancelExecution: async (execution) => {
      await registry.settleExecution(execution.id, {
        status: 'completed', expectedGeneration: execution.generation,
        result: { disposition: 'completed', summary: 'Late producer', outputs: {} },
      }).catch(() => { settlementRejected = true; });
    } });
    const task = await registry.createTask('Cancel safely');
    const execution = await registry.startExecution(task.id, { mode: 'subagent' });
    await registry.cancelTask(task.id);
    expect(settlementRejected).toBe(true);
    await expect(registry.getExecution(execution.id)).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('refuses graph revision of an active downstream task and cleans references on safe deletion', async () => {
    const registry = await createRegistry();
    const upstream = await registry.createTask('Upstream', { executionRequired: false });
    const downstream = await registry.createTask('Downstream');
    await registry.updateTask(upstream.id, { addBlocks: [downstream.id] });
    await registry.updateTask(upstream.id, { status: 'completed', result: { disposition: 'completed', summary: 'ready', outputs: {} } });
    await registry.startExecution(downstream.id, { mode: 'direct' });
    const another = await registry.createTask('Another');
    await expect(registry.updateTask(another.id, { addBlocks: [downstream.id] })).rejects.toThrow(/active task/);
    await registry.cancelTask(downstream.id);
    await registry.deleteTask(upstream.id);
    await expect(registry.getTask(downstream.id)).resolves.toMatchObject({ blockedBy: [] });
  });

  it('keeps terminal tasks terminal while allowing explicit retry from blocked', async () => {
    const registry = await createRegistry();
    const completed = await registry.createTask('Completed');
    const completedRun = await registry.startExecution(completed.id, { mode: 'direct' });
    await registry.settleExecution(completedRun.id, { status: 'completed', expectedGeneration: 1, result: { disposition: 'completed', summary: 'Done', outputs: {} } });
    await expect(registry.updateTask(completed.id, { status: 'pending' })).rejects.toThrow(/Terminal task/);
    await expect(registry.startExecution(completed.id, { mode: 'direct' })).rejects.toThrow(/Terminal task/);
    const blocked = await registry.createTask('Retryable');
    const first = await registry.startExecution(blocked.id, { mode: 'direct' });
    await registry.settleExecution(first.id, { status: 'blocked', expectedGeneration: 1, result: { disposition: 'blocked', summary: 'Retry', outputs: {} } });
    await expect(registry.startExecution(blocked.id, { mode: 'direct' })).resolves.toMatchObject({ generation: 2 });
  });

  it('rejects invalid or exhausted execution budgets', async () => {
    const registry = await createRegistry();
    const task = await registry.createTask('Budgeted');
    await expect(registry.startExecution(task.id, { mode: 'direct', budget: { maxToolCalls: 5, toolCalls: 6 } })).rejects.toThrow(/exhausted/);
    await expect(registry.startExecution(task.id, { mode: 'direct', budget: { deadlineAt: Date.now() - 1 } })).rejects.toThrow(/expired/);
  });

  it('keeps completed task semantics and dependency proof immutable', async () => {
    const registry = await createRegistry();
    const upstream = await registry.createTask('upstream', { completionRequirements: ['artifact'] });
    const downstream = await registry.createTask('downstream', { blockedBy: [upstream.id] });
    const run = await registry.startExecution(upstream.id, { mode: 'direct' });
    await registry.settleExecution(run.id, {
      expectedGeneration: run.generation,
      status: 'completed',
      result: { disposition: 'completed', summary: 'done', outputs: { artifact: 'artifact://one' } },
    });
    expect(await registry.canStart(downstream.id)).toBe(true);
    await expect(registry.updateTask(upstream.id, { completionRequirements: ['new-artifact'] }))
      .rejects.toThrow(/semantics are immutable/);
    expect(await registry.canStart(downstream.id)).toBe(true);
  });

  it('does not interrupt executions owned by this runtime instance', async () => {
    const registry = await createRegistry();
    const task = await registry.createTask('live');
    const execution = await registry.startExecution(task.id, { mode: 'direct' });
    expect(await registry.reconcileInterruptedExecutions()).toEqual([]);
    expect(await registry.getExecution(execution.id)).toMatchObject({ status: 'running' });
  });

  it('rejects completed results that admit missing requirements or unsuccessful children', async () => {
    const registry = await createRegistry();
    const parent = await registry.createTask('parent');
    const child = await registry.createTask('child', { parentTaskId: parent.id });
    const childRun = await registry.startExecution(child.id, { mode: 'direct' });
    await registry.settleExecution(childRun.id, { expectedGeneration: 1, status: 'cancelled', result: { disposition: 'cancelled', summary: 'cancelled', outputs: {} } });
    const parentRun = await registry.startExecution(parent.id, { mode: 'direct' });
    await expect(registry.settleExecution(parentRun.id, {
      expectedGeneration: 1,
      status: 'completed',
      result: { disposition: 'completed', summary: 'incorrect', outputs: {}, missingRequirements: ['child'] },
    })).rejects.toThrow(/missing requirements/);
  });

  it('fails closed without a managed cancellation owner and recursively joins descendants', async () => {
    const noOwner = await createRegistry();
    const orphan = await noOwner.createTask('Managed');
    await noOwner.startExecution(orphan.id, { mode: 'subagent' });
    await expect(noOwner.cancelTask(orphan.id)).rejects.toThrow(/abort-and-join owner/);

    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-tasks-'));
    roots.push(dir);
    const cancelled: string[] = [];
    const registry = new TaskRegistry(dir, { onCancelExecution: async (execution) => { cancelled.push(execution.taskId); } });
    const parent = await registry.createTask('Parent');
    const child = await registry.createTask('Child', { parentTaskId: parent.id });
    await registry.startExecution(parent.id, { mode: 'subagent' });
    await registry.startExecution(child.id, { mode: 'subagent' });
    await registry.cancelTask(parent.id);
    expect(cancelled).toEqual([child.id, parent.id]);
    await expect(registry.getTask(child.id)).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('accepts an independently settled cancelled result during cancellation join', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-tasks-'));
    roots.push(dir);
    let registry!: TaskRegistry;
    registry = new TaskRegistry(dir, { onCancelExecution: async (execution) => {
      await registry.settleExecution(execution.id, { status: 'cancelled', expectedGeneration: execution.generation, result: { disposition: 'cancelled', summary: 'Producer observed abort.', outputs: {} } });
    } });
    const task = await registry.createTask('Race');
    await registry.startExecution(task.id, { mode: 'subagent' });
    await expect(registry.cancelTask(task.id)).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('requires result references and hashes together', async () => {
    const registry = await createRegistry();
    const task = await registry.createTask('Referenced result');
    const execution = await registry.startExecution(task.id, { mode: 'direct' });
    await expect(registry.settleExecution(execution.id, {
      expectedGeneration: execution.generation,
      status: 'completed',
      result: { disposition: 'completed', summary: 'done', outputs: {}, resultRef: 'session://tool-outputs/result.json' },
    })).rejects.toThrow(/reference and hash/);
  });

  it('persists narrower budget ceilings and rejects restart widening', async () => {
    const registry = await createRegistry();
    const task = await registry.createTask('Narrow budget');
    const execution = await registry.startExecution(task.id, {
      mode: 'subagent',
      budget: { maxToolCalls: 10, maxSubagents: 4, maxChildDepth: 3, deadlineAt: Date.now() + 60_000 },
    });
    const narrowed = await registry.updateExecutionBudget(execution.id, {
      expectedGeneration: execution.generation,
      toolCalls: 2,
      maxToolCalls: 5,
      maxSubagents: 2,
      maxChildDepth: 2,
      deadlineAt: execution.budget.deadlineAt! - 1_000,
    });
    expect(narrowed.budget).toMatchObject({ toolCalls: 2, maxToolCalls: 5, maxSubagents: 2, maxChildDepth: 2 });
    await expect(registry.updateExecutionBudget(execution.id, {
      expectedGeneration: execution.generation,
      maxToolCalls: 6,
    })).rejects.toThrow(/only be narrowed/);
  });

  it('shares one monotonic root budget across sibling executions', async () => {
    const registry = await createRegistry();
    const deadlineAt = Date.now() + 60_000;
    const root = await registry.updateRootBudget('policy:100', {
      toolCalls: 1,
      subagents: 1,
      maxToolCalls: 8,
      maxSubagents: 4,
      maxChildDepth: 3,
      deadlineAt,
      startedAt: 100,
    });
    const firstTask = await registry.createTask('First sibling');
    const secondTask = await registry.createTask('Second sibling');
    const first = await registry.startExecution(firstTask.id, { mode: 'subagent', rootBudgetId: root.id });
    const second = await registry.startExecution(secondTask.id, { mode: 'subagent', rootBudgetId: root.id });
    expect(first.rootBudgetId).toBe(second.rootBudgetId);

    const advanced = await registry.updateRootBudget(root.id, {
      toolCalls: 5,
      subagents: 2,
      maxToolCalls: 7,
      maxSubagents: 3,
      maxChildDepth: 2,
      deadlineAt: deadlineAt - 1_000,
      startedAt: 100,
    });
    const stale = await registry.updateRootBudget(root.id, {
      toolCalls: 2,
      subagents: 1,
      maxToolCalls: 8,
      maxSubagents: 4,
      maxChildDepth: 3,
      deadlineAt,
      startedAt: 200,
    });
    expect(stale).toMatchObject({
      toolCalls: 5,
      subagents: 2,
      maxToolCalls: 7,
      maxSubagents: 3,
      maxChildDepth: 2,
      deadlineAt: deadlineAt - 1_000,
      startedAt: 100,
    });
    expect(advanced.id).toBe(root.id);
    await registry.settleExecution(first.id, {
      expectedGeneration: first.generation,
      status: 'blocked',
      result: { disposition: 'blocked', summary: 'retry required', outputs: {} },
    });
    const unrelated = await registry.updateRootBudget('policy:other', {
      toolCalls: 0, subagents: 0, maxToolCalls: 20, maxSubagents: 5, maxChildDepth: 4,
      deadlineAt, startedAt: 200,
    });
    const retry = await registry.startExecution(firstTask.id, { mode: 'subagent', rootBudgetId: unrelated.id });
    expect(retry.rootBudgetId).toBe(root.id);
  });
});
