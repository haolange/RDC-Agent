import {
  acquireDirectoryFileLock,
  releaseDirectoryFileLock,
  withDirectoryFileLock,
  type DirectoryFileLockOwner,
} from '../../sessions/directoryFileLock';

const LOCK_FILE_NAME = '.memory.lock';

export type MemoryDirectoryLockOwner = DirectoryFileLockOwner;

export async function acquireMemoryDirectoryLock(
  memoryDir: string,
  options: { maxAttempts?: number } = {},
): Promise<{ lockPath: string }> {
  return acquireDirectoryFileLock(memoryDir, {
    lockFileName: LOCK_FILE_NAME,
    timeoutCode: 'MEMORY_LOCK_TIMEOUT',
    ...(options.maxAttempts != null ? { maxAttempts: options.maxAttempts } : {}),
  });
}

export async function releaseMemoryDirectoryLock(lockPath: string): Promise<void> {
  await releaseDirectoryFileLock(lockPath);
}

export async function withMemoryDirectoryLock<T>(
  memoryDir: string,
  operation: () => Promise<T>,
): Promise<T> {
  return withDirectoryFileLock(memoryDir, {
    lockFileName: LOCK_FILE_NAME,
    timeoutCode: 'MEMORY_LOCK_TIMEOUT',
  }, operation);
}
