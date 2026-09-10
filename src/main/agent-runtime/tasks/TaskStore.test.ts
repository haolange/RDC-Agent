import * as fsPromises from 'fs/promises';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileTaskStore } from './TaskStore';
import { TaskRegistry } from './TaskRegistry';

vi.mock('fs/promises', async importOriginal => { const actual = await importOriginal<typeof import('fs/promises')>(); return { ...actual, rename: vi.fn(actual.rename) }; });

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('FileTaskStore', () => {
  it('retries a transient atomic rename without replacing or duplicating Task state', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-task-store-')); roots.push(dir);
    const registry = new TaskRegistry(dir); await registry.createTask('Existing');
    const target = path.join(dir, 'task-state.json'); const original = await readFile(target, 'utf8');
    const rename = (await vi.importActual<typeof import('fs/promises')>('fs/promises')).rename; let locked = false;
    const spy = vi.spyOn(fsPromises, 'rename').mockClear().mockImplementation(async (from, to) => {
      if (!locked && to === target) { locked = true; expect(await readFile(target, 'utf8')).toBe(original); throw Object.assign(new Error('sharing violation'), { code: 'EPERM' }); }
      return rename(from, to);
    });
    try { await registry.createTask('New'); expect(spy).toHaveBeenCalledTimes(2); }
    finally { spy.mockRestore(); }
    expect((await registry.listTasks()).map(task => task.subject).sort()).toEqual(['Existing', 'New']);
  });

  it('preserves the authoritative state and removes the candidate after persistent rename denial', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-task-store-')); roots.push(dir);
    const registry = new TaskRegistry(dir); await registry.createTask('Existing');
    const target = path.join(dir, 'task-state.json'); const original = await readFile(target, 'utf8');
    const spy = vi.spyOn(fsPromises, 'rename').mockClear().mockRejectedValue(Object.assign(new Error('denied'), { code: 'EPERM' }));
    try { await expect(registry.createTask('Rejected')).rejects.toMatchObject({ code: 'EPERM' }); expect(spy).toHaveBeenCalledTimes(4); }
    finally { spy.mockRestore(); }
    expect(await readFile(target, 'utf8')).toBe(original);
    expect((await fsPromises.readdir(dir)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('never silently converts or overwrites an existing noncurrent store', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-task-store-'));
    roots.push(dir);
    const original = '{"id":"task_old","subject":"Old","status":"completed"}';
    await writeFile(path.join(dir, 'task_old.json'), original);
    const store = new FileTaskStore(dir);
    await expect(store.listTasks()).rejects.toThrow('TASK_STORAGE_REQUIRES_CONVERSION');
    expect(await readFile(path.join(dir, 'task_old.json'), 'utf8')).toBe(original);
    await expect(readFile(path.join(dir, 'task-state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    // A failed initialization is retryable after an explicit offline conversion.
    await writeFile(path.join(dir, 'task-state.json'), JSON.stringify({ schemaVersion: 2, tasks: {}, executions: {}, messages: {}, rootBudgets: {} }));
    await expect(store.listTasks()).resolves.toEqual([]);
  });

  it('rejects malformed canonical records and dangling execution references', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdx-task-store-'));
    roots.push(dir);
    await writeFile(path.join(dir, 'task-state.json'), JSON.stringify({
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
      const statePath = path.join(dir, 'task-state.json');
      const state = JSON.parse(await readFile(statePath, 'utf8'));
      corrupt(state);
      await writeFile(statePath, JSON.stringify(state));
      await expect(new FileTaskStore(dir).listTasks()).rejects.toThrow(/Malformed|invalid current execution|not reciprocal/);
    }
  });
});
