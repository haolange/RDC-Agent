import { mkdtemp, readdir, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryStore } from './MemoryStore';

const roots: string[] = [];
const fsWrite = writeFile;
const pathExists = async (target: string): Promise<boolean> => {
  try { await access(target); return true; } catch { return false; }
};
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

  it('serializes writes from separate store instances targeting the same real directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-memory-instance-race-'));
    roots.push(root);
    const firstStore = new MemoryStore(root);
    const secondStore = new MemoryStore(path.join(root, '.'));
    const [first, second] = await Promise.all([
      firstStore.writeMemory({ name: 'Instance Race', description: 'first', type: 'user', content: 'one' }),
      secondStore.writeMemory({ name: 'Instance-Race', description: 'second', type: 'user', content: 'two' }),
    ]);

    expect(first.name).not.toBe(second.name);
    expect((await firstStore.listMemories()).map((record) => record.displayName).sort()).toEqual([
      'Instance Race',
      'Instance-Race',
    ]);
  });

  it('keeps user and project stores physically isolated', async () => {
    const userRoot = await mkdtemp(path.join(os.tmpdir(), 'rdx-user-memory-'));
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'rdx-project-memory-'));
    roots.push(userRoot, projectRoot);
    await new MemoryStore(userRoot).writeMemory({ name: 'identity', description: 'User identity', type: 'user', content: 'User scoped.' });
    expect(await new MemoryStore(projectRoot).getMemory('identity')).toBeNull();
  });

  it('keeps filename slug as path authority and ignores frontmatter path escape names', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-memory-escape-'));
    roots.push(root);
    const store = new MemoryStore(root);
    const evilPath = path.join(root, '..', 'escaped.md');
    await fsWrite(path.join(root, 'safe-slug.md'), [
      '---',
      'id: "mem_evil"',
      'name: "../../escaped"',
      'displayName: "Evil"',
      'normalizedName: "evil"',
      'description: "escape"',
      'type: "user"',
      'tags: []',
      'createdAt: 1',
      'updatedAt: 1',
      '---',
      '',
      'body',
      '',
    ].join('\n'));
    const record = await store.getMemory('safe-slug');
    expect(record).toMatchObject({ name: 'safe-slug', displayName: 'Evil', content: 'body' });
    expect(await pathExists(evilPath)).toBe(false);

    // Updating via the legitimate display owner rewrites the slug file only.
    await store.writeMemory({ name: 'Evil', description: 'updated', type: 'user', content: 'new body' });
    expect((await readdir(root)).filter((name) => name.endsWith('.md'))).toEqual(['safe-slug.md']);
    expect(await pathExists(evilPath)).toBe(false);
    expect(await store.getMemory('safe-slug')).toMatchObject({ name: 'safe-slug', content: 'new body' });

    // Path-like write names are slugified and contained under the memory dir.
    const written = await store.writeMemory({
      name: '../../outside',
      description: 'attempted escape',
      type: 'reference',
      content: 'contained',
    });
    expect(written.name.includes('..')).toBe(false);
    expect(written.name.includes('/') || written.name.includes('\\')).toBe(false);
    expect(await pathExists(path.join(root, `${written.name}.md`))).toBe(true);
    expect(await pathExists(path.join(root, '..', 'outside.md'))).toBe(false);
  });

  it('skips oversized memory files during listMemories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-memory-budget-'));
    roots.push(root);
    const store = new MemoryStore(root);
    await store.writeMemory({ name: 'ok', description: 'small', type: 'user', content: 'tiny' });
    const huge = path.join(root, 'huge.md');
    await fsWrite(huge, '---\nid: "x"\nname: "huge"\ndisplayName: "huge"\nnormalizedName: "huge"\ndescription: "d"\ntype: "user"\ntags: []\ncreatedAt: 1\nupdatedAt: 1\n---\n\n' + 'x'.repeat(600 * 1024));
    const listed = await store.listMemories();
    expect(listed.map((record) => record.name)).toEqual(['ok']);
  });

});
