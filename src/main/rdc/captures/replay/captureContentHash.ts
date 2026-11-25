import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { AppError } from '@shared/errors/appError';
import { openedFileIdentity, sameFileState } from '../../../platform/fileIdentity';

/**
 * Hash the file descriptor and verify the named file still identifies the same bytes.
 * Identity is compared between handle stats only; path stats only check the file type.
 */
export async function hashCaptureFile(filePath: string): Promise<{ sha256: string; size: number; mtimeMs: number }> {
  const link = await fs.lstat(filePath);
  if (!link.isFile() || link.isSymbolicLink()) throw new AppError('CAPTURE_UNSAFE_FILE');
  const handle = await fs.open(filePath, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat({ bigint: true });
    const named = await openedFileIdentity(filePath);
    const linkAfter = await fs.lstat(filePath);
    if (!sameFileState(before, after) || !sameFileState(after, named) || !linkAfter.isFile() || linkAfter.isSymbolicLink()) {
      throw new AppError('CAPTURE_CHANGED_DURING_HASH');
    }
    return { sha256: hash.digest('hex'), size: Number(after.size), mtimeMs: Number(after.mtimeNs) / 1e6 };
  } finally {
    await handle.close();
  }
}
