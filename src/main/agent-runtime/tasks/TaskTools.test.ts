import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskRegistry } from './TaskRegistry';
import { createTaskTools } from './TaskTools';
import { snapshotTaskRequirement } from './TaskExecutionRequirements';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  return first?.type === 'text' ? (first.text ?? '') : '';
}

describe('TaskTools', () => {
  it('does not acknowledge a result without settling its execution', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-tools-'));
    roots.push(dir);
    const registry = new TaskRegistry(dir);
    const task = await registry.createTask('Investigate before review');
    const update = createTaskTools(registry).find(tool => tool.name === 'task_update')!;
    const result = { disposition: 'partial' as const, summary: 'Observed a limited result', outputs: { investigation: 'partial evidence' },
      resultRef: 'session://tool-outputs/result.json', resultHash: 'a'.repeat(64) };

    await update.execute('start', { taskId: task.id, status: 'in_progress' });
    const firstId = (await registry.getTask(task.id))!.currentExecutionId!;
    const deadline = Date.now() + 60_000;
    await registry.updateExecutionBudget(firstId, { expectedGeneration: 1, toolCalls: 4, maxToolCalls: 10, deadlineAt: deadline });
    await expect(update.execute('result-alone-running', { taskId: task.id, result })).rejects.toThrow('result must accompany');
    await expect(registry.updateTask(task.id, { result })).rejects.toThrow('execution');
    expect(await registry.getExecution(firstId)).toMatchObject({ status: 'running' });
    expect((await registry.getTask(task.id))?.disposition).toBeUndefined();
    const pending = await registry.createTask('Not started');
    await expect(update.execute('start-with-result', { taskId: pending.id, status: 'in_progress', result }))
      .rejects.toThrow('result must accompany');
    expect((await registry.getTask(pending.id))?.status).toBe('pending');

    await update.execute('blocked', { taskId: task.id, status: 'blocked', statusReason: 'Evidence still missing' });
    await expect(update.execute('result-alone-settled', { taskId: task.id, result })).rejects.toThrow('result must accompany');
    expect(await registry.getTask(task.id)).toMatchObject({ status: 'blocked', disposition: 'blocked' });
    expect(await registry.getExecution(firstId)).toMatchObject({ status: 'blocked', result: { summary: 'Evidence still missing' } });

    await update.execute('resume', { taskId: task.id, status: 'in_progress' });
    const resumedId = (await registry.getTask(task.id))!.currentExecutionId!;
    await update.execute('settle-partial', { taskId: task.id, status: 'blocked', result });
    expect(await registry.getExecution(resumedId)).toMatchObject({ generation: 2, status: 'partial', result,
      budget: { toolCalls: 4, maxToolCalls: 10, deadlineAt: deadline } });
    expect(await registry.getTask(task.id)).toMatchObject({ status: 'blocked', disposition: 'partial' });
  });

  it('keeps a direct Task active when its result reference is invalid and allows correction', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-tools-'));
    roots.push(dir);
    const registry = new TaskRegistry(dir, { validateResultRef: async (_task, result) => result.resultRef === 'session://tool-outputs/result.json' && result.resultHash === 'a'.repeat(64) });
    const task = await registry.createTask('Produce reviewable result');
    const update = createTaskTools(registry).find(tool => tool.name === 'task_update')!;
    await update.execute('start', { taskId: task.id, status: 'in_progress' });
    const result = { disposition: 'completed', summary: 'Result prepared', outputs: { result: 'actual result' },
      resultRef: 'reports/result.md', resultHash: 'a'.repeat(64) };
    await expect(update.execute('invalid', { taskId: task.id, status: 'completed', result })).rejects.toThrow('result being reviewed');
    expect((await registry.getTask(task.id))?.status).toBe('in_progress');
    await update.execute('corrected', { taskId: task.id, status: 'completed', result: {
      ...result, resultRef: 'session://tool-outputs/result.json', resultHash: `sha256:${'A'.repeat(64)}`,
    } });
    expect((await registry.getTask(task.id))?.status).toBe('completed');
    const execution = await registry.getExecution((await registry.getTask(task.id))!.currentExecutionId!);
    expect(execution?.result?.resultHash).toBe('a'.repeat(64));
  });

  it('explains and preserves dependencies between tasks created in the same batch', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-tools-'));
    roots.push(dir);
    const registry = new TaskRegistry(dir);
    const byName = Object.fromEntries(createTaskTools(registry).map((tool) => [tool.name, tool]));
    const created = await byName.task_create!.execute('batch', {
      tasks: [{ subject: 'Collect evidence' }, { subject: 'Review evidence' }],
    });
    const [sourceId, reviewId] = (created.details as { ids: string[] }).ids;
    expect(textOf(created)).toContain('task_update');
    expect(textOf(created)).toContain('addBlockedBy');
    expect(textOf(created)).toContain('independentOfTaskIds');
    await byName.task_update!.execute('link', { taskId: reviewId, addBlockedBy: [sourceId],
      executionRequirements: { mode: 'subagent', profileId: 'verifier', independentOfTaskIds: [sourceId] } });
    const review = (await registry.getTask(reviewId!))!;
    expect(snapshotTaskRequirement(review).blockedBy).toEqual([sourceId]);
    expect(snapshotTaskRequirement(review).executionRequirements?.independentOfTaskIds).toEqual([sourceId]);
    expect(await registry.canStart(reviewId!)).toBe(false);
  });

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
