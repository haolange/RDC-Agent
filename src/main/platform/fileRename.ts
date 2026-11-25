import fs from 'node:fs';
import { currentHost, type HostDescriptor } from './host';

/**
 * Renaming a path (replacing a file, or moving a directory into place), and making the rename durable. The two
 * hosts differ in exactly these places:
 * - Windows: a reader, indexer or scanner that briefly holds the target open makes the rename fail with EBUSY,
 *   EPERM or EACCES; it succeeds once the handle closes, so the rename is retried for a short, bounded time.
 * - POSIX: the rename itself is atomic, but the new directory entry is only durable after the directory is fsynced.
 *   Windows has no directory handle to sync; NTFS journals the rename.
 */
const TRANSIENT_WINDOWS_RENAME = new Set(['EBUSY', 'EPERM', 'EACCES']);
const RENAME_ATTEMPTS = 5;
const retryDelayMs = (attempt: number): number => 15 * (attempt + 1);

function retryable(error: unknown, attempt: number, host: HostDescriptor): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return host.isWindows && code !== undefined && TRANSIENT_WINDOWS_RENAME.has(code) && attempt < RENAME_ATTEMPTS - 1;
}

export function renameWithRetrySync(source: string, target: string, host: HostDescriptor = currentHost(), rename = fs.renameSync): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      rename(source, target);
      return;
    } catch (error) {
      if (!retryable(error, attempt, host)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, retryDelayMs(attempt));
    }
  }
}

export async function renameWithRetry(
  source: string,
  target: string,
  host: HostDescriptor = currentHost(),
  rename: (from: string, to: string) => Promise<void> = fs.promises.rename,
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, target);
      return;
    } catch (error) {
      if (!retryable(error, attempt, host)) throw error;
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
    }
  }
}

export function syncDirectorySync(directory: string, host: HostDescriptor = currentHost()): void {
  if (host.isWindows) return;
  const fd = fs.openSync(directory, 'r');
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

export async function syncDirectory(directory: string, host: HostDescriptor = currentHost()): Promise<void> {
  if (host.isWindows) return;
  const handle = await fs.promises.open(directory, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
