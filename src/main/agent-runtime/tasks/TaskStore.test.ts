import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTaskStore } from './TaskStore';
import { TaskRegistry } from './TaskRegistry';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('FileTaskStore', () => {
  it('keeps a persisted retired terminal task terminal when read', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-task-store-'));
    roots.push(dir);
    await writeFile(path.join(dir, 'task_retired.json'), JSON.stringify({
      id: 'task_retired',
      subject: 'Retired terminal task',
      description: '',
      status: 'deleted',
      blockedBy: [],
      blocks: [],
      createdAt: 1,
      updatedAt: 2,
    }), 'utf8');

    await expect(new FileTaskStore(dir).loadTask('task_retired')).resolves.toMatchObject({
      id: 'task_retired',
      status: 'cancelled',
    });
  });

  it('derives missing createdAt from the task id and orders by that time', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-task-store-'));
    roots.push(dir);
    await writeFile(path.join(dir, 'task_2000_bb.json'), JSON.stringify({
      id: 'task_2000_bb',
      subject: 'Later',
      description: '',
      status: 'pending',
      blockedBy: [],
      blocks: [],
    }), 'utf8');
    await writeFile(path.join(dir, 'task_1000_aa.json'), JSON.stringify({
      id: 'task_1000_aa',
      subject: 'Earlier',
      description: '',
      status: 'pending',
      blockedBy: [],
      blocks: [],
    }), 'utf8');

    const listed = await new FileTaskStore(dir).listTasks();
    expect(listed.map((task) => task.id)).toEqual(['task_1000_aa', 'task_2000_bb']);
    expect(listed[0]?.createdAt).toBe(1000);
  });

  it('archives the exact legacy bytes and rejects unknown future schemas', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-task-store-'));
    roots.push(dir);
    const legacy = Buffer.from('{"id":"task_1_old","subject":"Old","status":"completed"}\r\n', 'utf8');
    await writeFile(path.join(dir, 'task_1_old.json'), legacy);
    const store = new FileTaskStore(dir);
    await expect(store.loadTask('task_1_old')).resolves.toMatchObject({ status: 'blocked', disposition: 'blocked' });
    const archives = await readdir(path.join(dir, 'archive', 'v1'));
    expect(await readFile(path.join(dir, 'archive', 'v1', archives[0]!))).toEqual(legacy);

    const futureDir = await mkdtemp(path.join(os.tmpdir(), 'rdx-task-store-'));
    roots.push(futureDir);
    await writeFile(path.join(futureDir, 'task_future.json'), JSON.stringify({ schemaVersion: 99, id: 'task_future', subject: 'Future' }));
    await expect(new FileTaskStore(futureDir).listTasks()).rejects.toThrow(/Unsupported task schema/);
  });

  it('rejects malformed canonical records and dangling execution references', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-task-store-'));
    roots.push(dir);
    await writeFile(path.join(dir, 'task-state.v2.json'), JSON.stringify({
      schemaVersion: 2,
      tasks: { broken: { schemaVersion: 2, id: 'broken', subject: 'Broken', blockedBy: [], blocks: [], executionIds: ['missing'], completionRequirements: [], revision: 1 } },
      executions: {},
      messages: {},
      rootBudgets: {},
    }));
    await expect(new FileTaskStore(dir).listTasks()).rejects.toThrow(/missing current execution|Malformed canonical task/);
  });

  it('rejects canonical ownership, graph, execution enum, and message corruption', async () => {
    const corruptions: Array<(state: any) => void> = [
      (state) => { const ids = Object.keys(state.tasks); state.tasks[ids[0]].blocks = []; },
      (state) => { const execution = Object.values(state.executions)[0] as any; execution.mode = 'unknown'; },
      (state) => { const ids = Object.keys(state.tasks); const execution = Object.values(state.executions)[0] as any; state.tasks[ids[1]].currentExecutionId = execution.id; },
      (state) => { const messages = Object.values(state.messages)[0] as any[]; messages[0].kind = 'noise'; },
    ];
    for (const corrupt of corruptions) {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-task-store-'));
      roots.push(dir);
      const registry = new TaskRegistry(dir);
      const first = await registry.createTask('First');
      await registry.createTask('Second', { blockedBy: [first.id] });
      const execution = await registry.startExecution(first.id, { mode: 'direct' });
      await registry.appendExecutionMessage(execution.id, { expectedGeneration: execution.generation, kind: 'progress', direction: 'to_parent', body: 'working' });
      const statePath = path.join(dir, 'task-state.v2.json');
      const state = JSON.parse(await readFile(statePath, 'utf8'));
      corrupt(state);
      await writeFile(statePath, JSON.stringify(state));
      await expect(new FileTaskStore(dir).listTasks()).rejects.toThrow(/Malformed|invalid current execution|not reciprocal/);
    }
  });
});
