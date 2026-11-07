import { describe, expect, it } from 'vitest';
import { MemoryTaskStore, TaskRegistry } from '../tasks';
import { activeDelegations, cancelPendingCreatedTasks } from './DirectTaskTurnLifecycle';

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
