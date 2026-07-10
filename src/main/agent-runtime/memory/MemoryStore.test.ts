import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryStore } from './MemoryStore';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('MemoryStore explicit scoped storage', () => {
  it('writes only the requested record and never creates an injectable index', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-memory-'));
    roots.push(root);
    const store = new MemoryStore(root);
    await store.writeMemory({ name: 'User Preference', description: 'Preferred language', type: 'user', content: 'Use Chinese.' });
    expect((await readdir(root)).sort()).toEqual(['user-preference.md']);
    expect(await store.searchMemories('Chinese')).toHaveLength(1);
    expect(await store.getMemory('user-preference')).toMatchObject({ content: 'Use Chinese.' });
  });

  it('keeps user and project stores physically isolated', async () => {
    const userRoot = await mkdtemp(path.join(os.tmpdir(), 'rdx-user-memory-'));
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'rdx-project-memory-'));
    roots.push(userRoot, projectRoot);
    await new MemoryStore(userRoot).writeMemory({ name: 'identity', description: 'User identity', type: 'user', content: 'User scoped.' });
    expect(await new MemoryStore(projectRoot).getMemory('identity')).toBeNull();
  });
});
