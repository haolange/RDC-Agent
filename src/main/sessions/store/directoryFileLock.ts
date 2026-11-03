import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEFAULT_MAX_LOCK_ATTEMPTS = 40;

export interface DirectoryFileLockOwner {
  pid: number;
  createdAt: number;
}

export interface DirectoryFileLockOptions {
  lockFileName: string;
  maxAttempts?: number;
  timeoutCode?: string;
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

function parseLockOwner(raw: string): DirectoryFileLockOwner | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DirectoryFileLockOwner>;
    if (typeof parsed.pid !== 'number' || typeof parsed.createdAt !== 'number') return null;
    return { pid: parsed.pid, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

function timeoutError(lockPath: string, timeoutCode: string): Error {
  return new Error(`${timeoutCode}: could not lock ${lockPath}`);
}

function sleepSync(ms: number): void {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

async function readLockOwner(lockPath: string): Promise<DirectoryFileLockOwner | null> {
  try {
    return parseLockOwner(await fs.readFile(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

function readLockOwnerSync(lockPath: string): DirectoryFileLockOwner | null {
  try {
    return parseLockOwner(readFileSync(lockPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Recover only when the owner is dead or the lock file is unreadable.
 * A live pid must never lose the lock, regardless of age.
 */
async function recoverStaleLock(lockPath: string): Promise<boolean> {
  const owner = await readLockOwner(lockPath);
  if (owner && isProcessAlive(owner.pid)) {
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

function recoverStaleLockSync(lockPath: string): boolean {
  const owner = readLockOwnerSync(lockPath);
  if (owner && isProcessAlive(owner.pid)) {
    return false;
  }
  try {
    unlinkSync(lockPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    return false;
  }
}

export async function acquireDirectoryFileLock(
  directory: string,
  options: DirectoryFileLockOptions,
): Promise<{ lockPath: string }> {
  await fs.mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, options.lockFileName);
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_LOCK_ATTEMPTS;
  const timeoutCode = options.timeoutCode ?? 'DIRECTORY_LOCK_TIMEOUT';
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      try {
        await handle.writeFile(JSON.stringify({
          pid: process.pid,
          createdAt: Date.now(),
        } satisfies DirectoryFileLockOwner), 'utf8');
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
  throw timeoutError(lockPath, timeoutCode);
}

export async function releaseDirectoryFileLock(lockPath: string): Promise<void> {
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

export async function withDirectoryFileLock<T>(
  directory: string,
  options: DirectoryFileLockOptions,
  operation: () => Promise<T>,
): Promise<T> {
  const { lockPath } = await acquireDirectoryFileLock(directory, options);
  try {
    return await operation();
  } finally {
    await releaseDirectoryFileLock(lockPath);
  }
}

export function releaseDirectoryFileLockSync(lockPath: string): void {
  const owner = readLockOwnerSync(lockPath);
  if (owner && owner.pid !== process.pid && isProcessAlive(owner.pid)) {
    return;
  }
  try {
    unlinkSync(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}

export function withDirectoryFileLockSync<T>(
  directory: string,
  options: DirectoryFileLockOptions,
  operation: () => T,
): T {
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
  const lockPath = path.join(directory, options.lockFileName);
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_LOCK_ATTEMPTS;
  const timeoutCode = options.timeoutCode ?? 'DIRECTORY_LOCK_TIMEOUT';
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx');
      try {
        writeFileSync(fd, JSON.stringify({
          pid: process.pid,
          createdAt: Date.now(),
        } satisfies DirectoryFileLockOwner), 'utf8');
      } finally {
        closeSync(fd);
      }
      let result: T | undefined;
      let operationError: unknown;
      let releaseError: unknown;
      try {
        result = operation();
      } catch (error) {
        operationError = error;
      } finally {
        try {
          releaseDirectoryFileLockSync(lockPath);
        } catch (error) {
          releaseError = error;
        }
      }
      if (operationError) throw operationError;
      if (releaseError) throw releaseError;
      return result as T;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw error;
      recoverStaleLockSync(lockPath);
      sleepSync(15 * (attempt + 1));
    }
  }
  throw timeoutError(lockPath, timeoutCode);
}
