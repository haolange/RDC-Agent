import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileTaskStore } from './TaskStore';

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
});