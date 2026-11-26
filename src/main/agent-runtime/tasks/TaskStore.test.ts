import fs from 'node:fs';
import * as fsPromises from 'fs/promises';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileTaskStore } from './TaskStore';
import { TaskRegistry } from './TaskRegistry';

vi.mock('fs/promises', async (importOriginal) => ({ ...(await importOriginal<typeof import('fs/promises')>()) }));

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('FileTaskStore', () => {
  it('preserves the authoritative state and removes the candidate after persistent rename denial', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-store-'));
    roots.push(dir);
    const registry = new TaskRegistry(dir);
    await registry.createTask('Existing');
    const target = path.join(dir, 'task-state.json');
    const original = await readFile(target, 'utf8');
    const spy = vi
      .spyOn(fs.promises, 'rename')
      .mockRejectedValue(Object.assign(new Error('denied'), { code: 'EPERM' }));
    try {
      await expect(registry.createTask('Rejected')).rejects.toMatchObject({ code: 'EPERM' });
    } finally {
      spy.mockRestore();
    }
    expect(await readFile(target, 'utf8')).toBe(original);
    expect((await fsPromises.readdir(dir)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('never silently converts or overwrites an existing noncurrent store', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-store-'));
    roots.push(dir);
    const original = '{"id":"task_old","subject":"Old","status":"completed"}';
    await writeFile(path.join(dir, 'task_old.json'), original);
    const store = new FileTaskStore(dir);
    await expect(store.listTasks()).rejects.toThrow('TASK_STORAGE_REQUIRES_CONVERSION');
    expect(await readFile(path.join(dir, 'task_old.json'), 'utf8')).toBe(original);
    await expect(readFile(path.join(dir, 'task-state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    // A failed initialization is retryable after an explicit offline conversion.
    await writeFile(
      path.join(dir, 'task-state.json'),
      JSON.stringify({ schemaVersion: 2, tasks: {}, executions: {}, messages: {}, rootBudgets: {} }),
    );
    await expect(store.listTasks()).resolves.toEqual([]);
  });

  it('does not recreate or fail on an empty Task scope removed during a projection read', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-store-'));
    roots.push(parent);
    const dir = path.join(parent, 'session');
    await fsPromises.mkdir(dir);
    const statePath = path.join(dir, 'task-state.json');
    const realReadFile = (await vi.importActual<typeof import('fs/promises')>('fs/promises')).readFile;
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(fsPromises, 'readFile')
      .mockImplementation(async (...args: Parameters<typeof fsPromises.readFile>) => {
        if (args[0] === statePath) {
          enter();
          await gate;
        }
        return realReadFile(...args);
      });
    try {
      const read = new FileTaskStore(dir).listTasks();
      await entered;
      await rm(dir, { recursive: true });
      release();
      await expect(read).resolves.toEqual([]);
      await expect(fsPromises.stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      release();
      spy.mockRestore();
    }
  });

  it('does not create Task storage when reading an empty or deleted session', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-store-'));
    roots.push(parent);
    const dir = path.join(parent, 'session');
    const store = new FileTaskStore(dir);
    await expect(store.listTasks()).resolves.toEqual([]);
    await expect(fsPromises.stat(dir)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reads consistently when the first Task write starts during an empty read', async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-store-'));
    roots.push(parent);
    const dir = path.join(parent, 'session');
    const target = path.join(dir, 'task-state.json');
    const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
    let startRead!: () => void;
    let releaseRead!: () => void;
    let startRename!: () => void;
    let releaseRename!: () => void;
    let readDirectory!: () => void;
    const readStarted = new Promise<void>((resolve) => {
      startRead = resolve;
    });
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve;
    });
    const renameStarted = new Promise<void>((resolve) => {
      startRename = resolve;
    });
    const renameGate = new Promise<void>((resolve) => {
      releaseRename = resolve;
    });
    const directoryRead = new Promise<void>((resolve) => {
      readDirectory = resolve;
    });
    let firstRead = true;
    let firstRename = true;
    const readSpy = vi
      .spyOn(fsPromises, 'readFile')
      .mockImplementation(async (...args: Parameters<typeof fsPromises.readFile>) => {
        if (args[0] === target && firstRead) {
          firstRead = false;
          startRead();
          await readGate;
        }
        return actual.readFile(...args);
      });
    const realRename = fs.promises.rename;
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (from, to) => {
      if (to === target && firstRename) {
        firstRename = false;
        startRename();
        await renameGate;
      }
      return realRename(from, to);
    });
    const readdirSpy = vi
      .spyOn(fsPromises, 'readdir')
      .mockImplementation(async (...args: Parameters<typeof fsPromises.readdir>) => {
        const entries = await actual.readdir(...args);
        if (args[0] === dir && entries.some((entry) => String(entry).endsWith('.tmp'))) readDirectory();
        return entries;
      });
    try {
      const store = new FileTaskStore(dir);
      const read = store.listTasks();
      await readStarted;
      const write = store.commit({});
      await renameStarted;
      releaseRead();
      await directoryRead;
      releaseRename();
      await expect(Promise.all([read, write])).resolves.toEqual([[], undefined]);
    } finally {
      releaseRead();
      releaseRename();
      readSpy.mockRestore();
      renameSpy.mockRestore();
      readdirSpy.mockRestore();
    }
  });

  it('rejects malformed canonical records and dangling execution references', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-store-'));
    roots.push(dir);
    await writeFile(
      path.join(dir, 'task-state.json'),
      JSON.stringify({
        schemaVersion: 2,
        tasks: {
          broken: {
            schemaVersion: 2,
            id: 'broken',
            subject: 'Broken',
            blockedBy: [],
            blocks: [],
            executionIds: ['missing'],
            completionRequirements: [],
            revision: 1,
          },
        },
        executions: {},
        messages: {},
        rootBudgets: {},
      }),
    );
    await expect(new FileTaskStore(dir).listTasks()).rejects.toThrow(
      /missing current execution|Malformed canonical task/,
    );
  });

  it('reports a task record that is not one this store writes as damaged storage', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-store-'));
    roots.push(dir);
    const registry = new TaskRegistry(dir);
    await registry.createTask('Stored');
    const statePath = path.join(dir, 'task-state.json');
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    (Object.values(state.tasks)[0] as { revision: unknown }).revision = 'first';
    await writeFile(statePath, JSON.stringify(state));
    await expect(new FileTaskStore(dir).listTasks()).rejects.toMatchObject({ code: 'STORAGE_CORRUPT' });
  });

  it('rejects canonical ownership, graph, execution enum, and message corruption', async () => {
    const corruptions: Array<(state: any) => void> = [
      (state) => {
        const ids = Object.keys(state.tasks);
        state.tasks[ids[0]].blocks = [];
      },
      (state) => {
        const execution = Object.values(state.executions)[0] as any;
        execution.mode = 'unknown';
      },
      (state) => {
        const execution = Object.values(state.executions)[0] as any;
        execution.dispatch = 'detached';
      },
      (state) => {
        const ids = Object.keys(state.tasks);
        const execution = Object.values(state.executions)[0] as any;
        state.tasks[ids[1]].currentExecutionId = execution.id;
      },
      (state) => {
        const messages = Object.values(state.messages)[0] as any[];
        messages[0].kind = 'noise';
      },
    ];
    for (const corrupt of corruptions) {
      const dir = await mkdtemp(path.join(os.tmpdir(), 'rdc-task-store-'));
      roots.push(dir);
      const registry = new TaskRegistry(dir);
      const first = await registry.createTask('First');
      await registry.createTask('Second', { blockedBy: [first.id] });
      const execution = await registry.startExecution(first.id, { mode: 'direct' });
      await registry.appendExecutionMessage(execution.id, {
        expectedGeneration: execution.generation,
        kind: 'progress',
        direction: 'to_parent',
        body: 'working',
      });
      const statePath = path.join(dir, 'task-state.json');
      const state = JSON.parse(await readFile(statePath, 'utf8'));
      corrupt(state);
      await writeFile(statePath, JSON.stringify(state));
      await expect(new FileTaskStore(dir).listTasks()).rejects.toThrow(
        /Malformed|invalid current execution|not reciprocal/,
      );
    }
  });
});
