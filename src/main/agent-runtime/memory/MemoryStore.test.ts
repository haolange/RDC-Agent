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

  it('slugifies Chinese names with Unicode letters and hash-fallback for emoji-only', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-memory-cjk-'));
    roots.push(root);
    const store = new MemoryStore(root);
    const cjk = await store.writeMemory({
      name: '用户偏好',
      description: '语言',
      type: 'user',
      content: '使用中文。',
    });
    expect(cjk.name).toBe('用户偏好');
    expect(await readdir(root)).toContain('用户偏好.md');
    expect(await store.getMemory('用户偏好')).toMatchObject({ content: '使用中文。' });

    const emoji = await store.writeMemory({
      name: '🎉🎉',
      description: 'emoji',
      type: 'reference',
      content: 'party',
    });
    expect(emoji.name.startsWith('mem-')).toBe(true);
    expect(await store.getMemory(emoji.name)).toMatchObject({ content: 'party' });
  });

  it('keeps colliding display names in separate owned records', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-memory-collision-'));
    roots.push(root);
    const store = new MemoryStore(root);
    const first = await store.writeMemory({ name: 'A B', description: 'first', type: 'user', content: 'one' });
    const second = await store.writeMemory({ name: 'A-B', description: 'second', type: 'user', content: 'two' });
    expect(second.name).not.toBe(first.name);
    expect(second.displayName).toBe('A-B');
    expect(await store.getMemory('A B')).toMatchObject({ displayName: 'A B', content: 'one' });
    expect(await store.getMemory('A-B')).toMatchObject({ displayName: 'A-B', content: 'two' });
    expect(await store.getMemory(first.name)).toMatchObject({ displayName: 'A B', content: 'one' });
    expect(await store.getMemory(second.name)).toMatchObject({ displayName: 'A-B', content: 'two' });
  });

  it('serializes colliding writes and preserves both owners', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-memory-race-'));
    roots.push(root);
    const store = new MemoryStore(root);
    const [first, second] = await Promise.all([
      store.writeMemory({ name: 'Race Name', description: 'first', type: 'user', content: 'one' }),
      store.writeMemory({ name: 'Race-Name', description: 'second', type: 'user', content: 'two' }),
    ]);
    expect(first.name).not.toBe(second.name);
    expect((await store.listMemories()).map((record) => record.displayName).sort()).toEqual(['Race Name', 'Race-Name']);
  });

  it('keeps user and project stores physically isolated', async () => {
    const userRoot = await mkdtemp(path.join(os.tmpdir(), 'rdx-user-memory-'));
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'rdx-project-memory-'));
    roots.push(userRoot, projectRoot);
    await new MemoryStore(userRoot).writeMemory({ name: 'identity', description: 'User identity', type: 'user', content: 'User scoped.' });
    expect(await new MemoryStore(projectRoot).getMemory('identity')).toBeNull();
  });
});
