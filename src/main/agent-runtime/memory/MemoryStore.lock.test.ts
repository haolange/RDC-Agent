import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireMemoryDirectoryLock, releaseMemoryDirectoryLock } from './memoryDirectoryLock';
import { MemoryStore } from './MemoryStore';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('memoryDirectoryLock', () => {
  it('recovers a stale lock from a dead pid', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-memory-stale-'));
    roots.push(root);
    const lockPath = path.join(root, '.memory.lock');
    await writeFile(lockPath, JSON.stringify({ pid: 1, createdAt: Date.now() - 120_000 }), 'utf8');
    const acquired = await acquireMemoryDirectoryLock(root);
    expect(acquired.lockPath).toBe(lockPath);
    await releaseMemoryDirectoryLock(lockPath);
  });
});

describe('MemoryStore cross-process lock', () => {
  it('serializes two node processes writing the same memory directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdx-memory-xproc-'));
    roots.push(root);
    const workerPath = path.join(root, 'worker.cjs');
    const registerPath = path.resolve(__dirname, '../../../../scripts/register-ts-source.cjs');
    const storePath = path.resolve(__dirname, './MemoryStore.ts');
    await writeFile(workerPath, `
require(${JSON.stringify(registerPath)});
const { MemoryStore } = require(${JSON.stringify(storePath)});
const name = process.env.MEMORY_NAME;
const content = process.env.MEMORY_CONTENT;
const dir = process.env.MEMORY_DIR;
(async () => {
  const store = new MemoryStore(dir);
  const record = await store.writeMemory({
    name,
    description: name,
    type: 'user',
    content,
  });
  process.stdout.write(JSON.stringify(record));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
`, 'utf8');

    const spawnWorker = (name: string, content: string) => new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [workerPath], {
        env: {
          ...process.env,
          MEMORY_DIR: root,
          MEMORY_NAME: name,
          MEMORY_CONTENT: content,
        },
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += String(chunk); });
      child.stderr.on('data', (chunk) => { stderr += String(chunk); });
      child.on('error', reject);
      child.on('close', (code) => resolve({ code, stdout, stderr }));
    });

    const [first, second] = await Promise.all([
      spawnWorker('Process A', 'one'),
      spawnWorker('Process-B', 'two'),
    ]);
    expect(first.code, first.stderr).toBe(0);
    expect(second.code, second.stderr).toBe(0);
    const store = new MemoryStore(root);
    const listed = (await store.listMemories()).map((record) => record.displayName).sort();
    expect(listed).toEqual(['Process A', 'Process-B']);
    const lockExists = await readFile(path.join(root, '.memory.lock'), 'utf8').then(() => true, () => false);
    expect(lockExists).toBe(false);
  }, 20_000);
});
