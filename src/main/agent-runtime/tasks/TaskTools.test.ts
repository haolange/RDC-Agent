import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskRegistry } from './TaskRegistry';
import { createTaskTools } from './TaskTools';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  return first?.type === 'text' ? (first.text ?? '') : '';
}

describe('TaskTools', () => {
  it('executes all five task tools', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-tools-'));
    roots.push(dir);
    const registry = new TaskRegistry(dir);
    const tools = createTaskTools(registry);
    expect(tools.map((tool) => tool.name)).toEqual([
      'task_create',
      'task_update',
      'task_get',
      'task_list',
      'task_stop',
    ]);

    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

    const created = await byName.task_create!.execute('c1', {
      tasks: [{ subject: 'Ship feature', description: 'End-to-end' }],
    });
    expect(textOf(created)).toContain('Created');
    const taskId = (created.details as { ids: string[] }).ids[0]!;

    const listed = await byName.task_list!.execute('l1', {});
    expect(textOf(listed)).toContain(taskId);
    expect((listed.details as { count: number }).count).toBe(1);

    const got = await byName.task_get!.execute('g1', { taskId });
    expect(textOf(got)).toContain('Ship feature');
    expect((got.details as { found: boolean }).found).toBe(true);

    const updated = await byName.task_update!.execute('u1', {
      taskId,
      status: 'in_progress',
    });
    expect(textOf(updated)).toContain('in_progress');

    const stopped = await byName.task_stop!.execute('s1', { taskId });
    expect(textOf(stopped)).toContain('Stopped');
    expect((await registry.getTask(taskId))?.status).toBe('cancelled');
    expect(byName.task_stop!.description).toContain('wait for managed producers to stop');
  });

  it('creates a durable parent-child Task relationship through the tool surface', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-tools-'));
    roots.push(dir);
    const registry = new TaskRegistry(dir);
    const create = createTaskTools(registry).find((tool) => tool.name === 'task_create')!;
    const parent = await create.execute('parent', { tasks: [{ subject: 'Parent' }] });
    const parentTaskId = (parent.details as { ids: string[] }).ids[0]!;
    const child = await create.execute('child', { tasks: [{ subject: 'Child', parentTaskId }] });
    const childTaskId = (child.details as { ids: string[] }).ids[0]!;
    await expect(registry.getTask(childTaskId)).resolves.toMatchObject({ parentTaskId });
  });

  it('requires an explicit continuation flag and a later host turn to resume the same cancelled goal', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-tools-'));
    roots.push(dir);
    const registry = new TaskRegistry(dir);
    const task = await registry.createTask('Resume without a replacement Task');
    let turn = 'turn:first:generation:1';
    const update = createTaskTools(registry, { startOptions: () => ({ frozenPlanRef: turn }) })[1]!;
    await update.execute('start', { taskId: task.id, status: 'in_progress' });
    await registry.cancelTask(task.id);
    await expect(update.execute('same-turn', { taskId: task.id, status: 'in_progress', resumeCancelled: true })).rejects.toThrow(/later turn/);
    turn = 'turn:next:generation:1';
    await expect(update.execute('implicit', { taskId: task.id, status: 'in_progress' })).rejects.toThrow(/Terminal task/);
    await expect(update.execute('invalid', { taskId: task.id, status: 'pending', resumeCancelled: true })).rejects.toThrow(/status=in_progress/);
    await expect(update.execute('invalid-type', { taskId: task.id, status: 'in_progress', resumeCancelled: 'true' })).rejects.toThrow(/boolean/);
    await update.execute('resume', { taskId: task.id, status: 'in_progress', resumeCancelled: true });
    expect(await registry.listExecutions(task.id)).toMatchObject([{ status: 'cancelled', generation: 1 }, { status: 'running', generation: 2 }]);
    expect(await registry.listTasks()).toHaveLength(1);
  });

  it('binds tool-created Tasks to the current turn without exposing an agent-provided owner', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-tools-'));
    roots.push(dir);
    const registry = new TaskRegistry(dir);
    const creationTurnRef = 'turn:stopped:generation:1';
    const create = createTaskTools(registry, { getCreationTurnRef: () => creationTurnRef })
      .find((tool) => tool.name === 'task_create')!;
    const result = await create.execute('c1', { tasks: [{ subject: 'Only this turn' }] });
    const taskId = (result.details as { ids: string[] }).ids[0]!;
    await expect(registry.getTask(taskId)).resolves.toMatchObject({ creationTurnRef });
  });

  it('does not let a delegated scope resume a cancelled descendant', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-tools-'));
    roots.push(dir);
    const registry = new TaskRegistry(dir);
    const parent = await registry.createTask('Parent');
    const child = await registry.createTask('Child', { parentTaskId: parent.id });
    await registry.startExecution(child.id, { mode: 'direct', frozenPlanRef: 'turn:old:generation:1' });
    await registry.cancelTask(child.id);
    const update = createTaskTools(registry, { scopeRootTaskId: parent.id,
      startOptions: () => ({ frozenPlanRef: 'turn:new:generation:1' }) })[1]!;
    await expect(update.execute('resume', { taskId: child.id, status: 'in_progress', resumeCancelled: true })).rejects.toThrow(/non-delegated turn/);
    expect(await registry.listExecutions(child.id)).toHaveLength(1);
  });
});
