import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { appPathService } from '../../runtime/AppPathService';

export const assertHash = (value: string): void => {
  if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error('REPLAY_INVALID_HASH');
};
export const assertSession = (value: string): void => {
  if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(value)) throw new Error('REPLAY_INVALID_SESSION');
};
export const missing = (error: unknown): boolean => (error as NodeJS.ErrnoException).code === 'ENOENT';

/** Reject every link beneath the canonical project root, including Windows junctions. */
export async function safePath(projectRoot: string, target: string): Promise<void> {
  const root = path.resolve(projectRoot);
  const relative = path.relative(root, path.resolve(target));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('REPLAY_PATH_ESCAPE');
  const realRoot = await fs.realpath(root);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error('REPLAY_UNSAFE_LINK');
      const resolved = await fs.realpath(current);
      const actual = path.relative(realRoot, resolved);
      if (actual.startsWith('..') || path.isAbsolute(actual)) throw new Error('REPLAY_PATH_ESCAPE');
    } catch (error) { if (missing(error)) return; throw error; }
  }
}

export async function treeBytes(projectRoot: string, root: string): Promise<number> {
  await safePath(projectRoot, root);
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch (error) { if (missing(error)) return 0; throw error; }
  let total = 0;
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    await safePath(projectRoot, target);
    if (entry.isDirectory()) total += await treeBytes(projectRoot, target);
    else if (entry.isFile()) total += (await fs.stat(target)).size;
    else throw new Error('REPLAY_UNSAFE_ENTRY');
  }
  return total;
}

export async function atomicWrite(projectRoot: string, target: string, bytes: Buffer): Promise<void> {
  await safePath(projectRoot, target);
  const temporary = path.join(path.dirname(target), `.pending-${process.pid}-${randomUUID()}`);
  try {
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await safePath(projectRoot, target);
    await fs.rename(temporary, target);
  } finally { await fs.rm(temporary, { force: true }); }
}

const queues = new Map<string, Promise<void>>();
async function diskLock(projectRoot: string): Promise<() => Promise<void>> {
  const directory = appPathService.getProjectRdcPaths(projectRoot).projectRdcRoot;
  await safePath(projectRoot, directory);
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, 'replay.lock');
  await safePath(projectRoot, target);
  const token = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(target, 'wx');
      const created = await handle.stat();
      try {
        await handle.writeFile(JSON.stringify({ pid: process.pid, token })); await handle.sync();
      } catch (error) {
        await handle.close();
        await safePath(projectRoot, target);
        const current = await fs.lstat(target);
        // Only remove the inode exclusively created by this attempt, never a replacement owner.
        if (current.dev === created.dev && current.ino === created.ino && current.birthtimeMs === created.birthtimeMs) {
          const contents = await fs.readFile(target, 'utf8');
          let recordedToken: unknown;
          try { recordedToken = (JSON.parse(contents) as { token?: unknown }).token; } catch { /* interrupted own write */ }
          if (recordedToken === undefined || recordedToken === token) await fs.unlink(target);
        }
        throw error;
      }
      await handle.close();
      return async () => {
        await safePath(projectRoot, target);
        const owner = JSON.parse(await fs.readFile(target, 'utf8')) as { token: string };
        if (owner.token !== token) throw new Error('REPLAY_LOCK_OWNERSHIP_LOST');
        await fs.unlink(target);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const before = await fs.stat(target);
      let owner: { pid: number };
      try { owner = JSON.parse(await fs.readFile(target, 'utf8')) as { pid: number }; } catch { throw new Error('REPLAY_LOCK_CORRUPT'); }
      if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw new Error('REPLAY_LOCK_CORRUPT');
      try { process.kill(owner.pid, 0); throw new Error('REPLAY_STORE_BUSY'); } catch (probeError) {
        if ((probeError as NodeJS.ErrnoException).code !== 'ESRCH') throw probeError;
      }
      const after = await fs.stat(target);
      if (before.ino !== after.ino || before.mtimeMs !== after.mtimeMs || before.size !== after.size) throw new Error('REPLAY_STORE_BUSY');
      await fs.unlink(target);
    }
  }
  throw new Error('REPLAY_STORE_BUSY');
}

export async function projectLock<T>(projectRoot: string, operation: () => Promise<T>): Promise<T> {
  const key = await fs.realpath(projectRoot);
  const previous = queues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const tail = previous.then(() => new Promise<void>((resolve) => { release = resolve; }));
  queues.set(key, tail);
  await previous;
  // Let the tail's synchronous executor install the release callback.
  await Promise.resolve();
  let unlock: (() => Promise<void>) | undefined;
  try { unlock = await diskLock(projectRoot); return await operation(); } finally {
    try { await unlock?.(); } finally {
    release();
    if (queues.get(key) === tail) queues.delete(key);
    }
  }
}
