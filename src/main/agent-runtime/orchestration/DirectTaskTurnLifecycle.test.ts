import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { subagentScopeId } from '@shared/utils/executionScope';
import { MemoryTaskStore, TaskRegistry, taskStoreForExecutionScope, releaseScopeTaskStore, resolveSessionTasksDir } from '../tasks';
import { activeDelegations, cancelPendingCreatedTasks, listUnfinishedDirectTasks, settleUnfinishedDirectTasks } from './DirectTaskTurnLifecycle';

describe('stopped turn Task cleanup', () => {
  it('cancels only unstarted Tasks created by the stopped turn', async () => {
    const registry = new TaskRegistry(new MemoryTaskStore());
    const earlier = await registry.createTask('Earlier pending', { creationTurnRef: 'turn:earlier:generation:1' });
    const unowned = await registry.createTask('Existing pending');
    const [first, second] = await registry.createTasks([
      { subject: 'Stopped first', creationTurnRef: 'turn:stopped:generation:1' },
      { subject: 'Stopped second', creationTurnRef: 'turn:stopped:generation:1' },
    ]);

    expect(await cancelPendingCreatedTasks(registry, 'turn:stopped:generation:1')).toBe(2);
    expect((await registry.getTask(first!.id))?.status).toBe('cancelled');
    expect((await registry.getTask(second!.id))?.statusReason).toBe('Creating turn stopped before this Task started.');
    expect((await registry.getTask(earlier.id))?.status).toBe('pending');
    expect((await registry.getTask(unowned.id))?.status).toBe('pending');
    expect(await cancelPendingCreatedTasks(registry, 'turn:stopped:generation:1')).toBe(0);
  });

  it('does not cascade cancellation into another turn\'s unfinished child', async () => {
    const registry = new TaskRegistry(new MemoryTaskStore());
    const parent = await registry.createTask('Stopped parent', { creationTurnRef: 'turn:stopped:generation:1' });
    const child = await registry.createTask('Other turn child', {
      parentTaskId: parent.id, creationTurnRef: 'turn:other:generation:1',
    });

    expect(await cancelPendingCreatedTasks(registry, 'turn:stopped:generation:1')).toBe(0);
    expect((await registry.getTask(parent.id))?.status).toBe('pending');
    expect((await registry.getTask(child.id))?.status).toBe('pending');
  });
});

it('identifies active children without treating a sibling or the current child as its own descendant', async () => {
  const registry = new TaskRegistry(new MemoryTaskStore());
  const root = await registry.createTask('Root');
  const first = await registry.startExecution(root.id, { mode: 'subagent' });
  const nested = await registry.createTask('Nested', { parentTaskId: root.id });
  const nestedExecution = await registry.startExecution(nested.id, { mode: 'subagent', parentExecutionId: first.id });
  const sibling = await registry.createTask('Sibling');
  const siblingExecution = await registry.startExecution(sibling.id, { mode: 'subagent' });
  const executions = await registry.listExecutions();
  expect(activeDelegations(executions).map(item => item.id)).toEqual(expect.arrayContaining([first.id, nestedExecution.id, siblingExecution.id]));
  expect(activeDelegations(executions, first.id).map(item => item.id)).toEqual([nestedExecution.id]);
  await registry.settleExecution(nestedExecution.id, { expectedGeneration: 1, status: 'completed', result: { disposition: 'completed', summary: 'done', outputs: {} } });
  expect(activeDelegations(await registry.listExecutions(), first.id)).toEqual([]);
});

it('settles an unowned child turn in its transient Task store without creating an on-disk child scope', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-transient-task-'));
  const originalUserData = process.env.RDC_AGENT_USER_DATA;
  process.env.RDC_AGENT_USER_DATA = root;
  const scope = subagentScopeId('sess_parent', 'child');
  try {
    const registry = new TaskRegistry(taskStoreForExecutionScope(scope));
    const task = await registry.createTask('Transient work');
    const execution = await registry.startExecution(task.id, { mode: 'direct', frozenPlanRef: 'turn:child:generation:1' });
    expect(await listUnfinishedDirectTasks({ sessionId: scope, turnId: 'child', generation: 1 }))
      .toEqual([{ executionId: execution.id, taskId: task.id }]);
    expect(await settleUnfinishedDirectTasks({ sessionId: scope, turnId: 'child', generation: 1, stopped: true })).toBe(1);
    expect((await registry.getExecution(execution.id))?.status).toBe('cancelled');
    expect(fs.existsSync(resolveSessionTasksDir(scope))).toBe(false);
  } finally {
    releaseScopeTaskStore(scope);
    if (originalUserData === undefined) delete process.env.RDC_AGENT_USER_DATA;
    else process.env.RDC_AGENT_USER_DATA = originalUserData;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
