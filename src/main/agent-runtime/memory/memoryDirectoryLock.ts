import { promises as fs } from 'node:fs';
import path from 'node:path';

const LOCK_FILE_NAME = '.memory.lock';
const STALE_LOCK_MS = 30_000;
const MAX_LOCK_ATTEMPTS = 40;

export interface MemoryDirectoryLockOwner {
  pid: number;
  createdAt: number;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLockOwner(lockPath: string): Promise<MemoryDirectoryLockOwner | null> {
  try {
    const raw = await fs.readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<MemoryDirectoryLockOwner>;
    if (typeof parsed.pid !== 'number' || typeof parsed.createdAt !== 'number') return null;
    return { pid: parsed.pid, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

async function recoverStaleLock(lockPath: string): Promise<boolean> {
  const owner = await readLockOwner(lockPath);
  if (owner && isProcessAlive(owner.pid) && Date.now() - owner.createdAt < STALE_LOCK_MS) {
    return false;
  }
  try {
    await fs.unlink(lockPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    return false;
  }
}

export async function acquireMemoryDirectoryLock(memoryDir: string): Promise<{ lockPath: string }> {
  const lockPath = path.join(memoryDir, LOCK_FILE_NAME);
  for (let attempt = 0; attempt < MAX_LOCK_ATTEMPTS; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      try {
        await handle.writeFile(JSON.stringify({
          pid: process.pid,
          createdAt: Date.now(),
        } satisfies MemoryDirectoryLockOwner), 'utf8');
      } finally {
        await handle.close();
      }
      return { lockPath };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      await recoverStaleLock(lockPath);
      await new Promise((resolve) => setTimeout(resolve, 15 * (attempt + 1)));
    }
  }
  throw new Error(`MEMORY_LOCK_TIMEOUT: could not lock ${lockPath}`);
}

export async function releaseMemoryDirectoryLock(lockPath: string): Promise<void> {
  const owner = await readLockOwner(lockPath);
  if (owner && owner.pid !== process.pid && isProcessAlive(owner.pid)) {
    return;
  }
  try {
    await fs.unlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export async function withMemoryDirectoryLock<T>(
  memoryDir: string,
  operation: () => Promise<T>,
): Promise<T> {
  const { lockPath } = await acquireMemoryDirectoryLock(memoryDir);
  try {
    return await operation();
  } finally {
    await releaseMemoryDirectoryLock(lockPath);
  }
}
