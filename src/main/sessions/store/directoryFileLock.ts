import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, unlinkSync, readFileSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z, type ZodType } from 'zod';
import { currentProcessIdentity, probeProcess } from '../../platform/process';
import type { FileHandle } from 'node:fs/promises';

const DEFAULT_MAX_LOCK_ATTEMPTS = 40;

/** The owner's process identity; an empty birth was not recorded and is judged by pid. */
export interface DirectoryFileLockOwner {
  pid: number;
  birth: string;
  createdAt: number;
}

export interface DirectoryFileLockOptions {
  lockFileName: string;
  maxAttempts?: number;
  timeoutCode?: string;
}

/** Only a proven exit frees a lock; an unreadable identity keeps it held. */
function ownerHasExited(owner: DirectoryFileLockOwner): boolean {
  return probeProcess({ pid: owner.pid, birth: owner.birth }) === 'exited';
}

/** A birth the owner did not record is the type's empty "not recorded" marker; such an owner is judged by pid. */
const DirectoryFileLockOwnerSchema: ZodType<DirectoryFileLockOwner> = z.object({ pid: z.number(), birth: z.string().catch(''), createdAt: z.number() });

/** The recorded owner, or null while the lock is not (yet) a complete owner record; such a lock stays held. */
function parseLockOwner(raw: string): DirectoryFileLockOwner | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const owner = DirectoryFileLockOwnerSchema.safeParse(value);
  return owner.success ? owner.data : null;
}

/** Built before the exclusive create so the owner identity is never read while holding an empty lock. */
function lockOwnerRecord(): string {
  const { pid, birth } = currentProcessIdentity();
  return JSON.stringify({ pid, birth, createdAt: Date.now() } satisfies DirectoryFileLockOwner);
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
 * Recover only when the recorded owner is dead. An unreadable lock may be
 * between exclusive creation and its owner's write, so it must not be stolen.
 */
async function recoverStaleLock(lockPath: string): Promise<boolean> {
  const owner = await readLockOwner(lockPath);
  if (!owner || !ownerHasExited(owner)) {
    return false;
  }
  // Only one contender may decide and remove a dead owner's lock. Otherwise a
  // delayed contender can unlink the new owner's lock after another recovers it.
  const recoveryPath = `${lockPath}.recovery`;
  let recovery: FileHandle;
  try { recovery = await fs.open(recoveryPath, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try {
    const current = await readLockOwner(lockPath);
    if (!current || !ownerHasExited(current)) return false;
    try { await fs.unlink(lockPath); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      return false;
    }
  } finally {
    try { await recovery.close(); } finally { await fs.unlink(recoveryPath); }
  }
}

function recoverStaleLockSync(lockPath: string): boolean {
  const owner = readLockOwnerSync(lockPath);
  if (!owner || !ownerHasExited(owner)) {
    return false;
  }
  const recoveryPath = `${lockPath}.recovery`;
  let recovery: number;
  try { recovery = openSync(recoveryPath, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try {
    const current = readLockOwnerSync(lockPath);
    if (!current || !ownerHasExited(current)) return false;
    try { unlinkSync(lockPath); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      return false;
    }
  } finally {
    try { closeSync(recovery); } finally { unlinkSync(recoveryPath); }
  }
}

export async function acquireDirectoryFileLock(
  directory: string,
  options: DirectoryFileLockOptions,
): Promise<{ lockPath: string }> {
  await fs.mkdir(directory, { recursive: true });
  const lockPath = path.join(directory, options.lockFileName);
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_LOCK_ATTEMPTS;
  const ownerRecord = lockOwnerRecord();
  const timeoutCode = options.timeoutCode ?? 'DIRECTORY_LOCK_TIMEOUT';
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      try {
        await handle.writeFile(ownerRecord, 'utf8');
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
  if (owner && owner.pid !== process.pid && !ownerHasExited(owner)) {
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
  if (owner && owner.pid !== process.pid && !ownerHasExited(owner)) {
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
  const ownerRecord = lockOwnerRecord();
  const timeoutCode = options.timeoutCode ?? 'DIRECTORY_LOCK_TIMEOUT';
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const fd = openSync(lockPath, 'wx');
      try {
        writeFileSync(fd, ownerRecord, 'utf8');
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
