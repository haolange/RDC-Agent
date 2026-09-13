import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';

/** Hash the file descriptor and verify the named file still identifies the same bytes. */
export async function hashCaptureFile(filePath: string): Promise<{ sha256: string; size: number; mtimeMs: number }> {
  const namedBefore = await fs.lstat(filePath, { bigint: true });
  if (!namedBefore.isFile() || namedBefore.isSymbolicLink()) throw new Error('CAPTURE_UNSAFE_FILE');
  const handle = await fs.open(filePath, 'r');
  try {
    const before = await handle.stat({ bigint: true });
    const hash = createHash('sha256');
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
    const after = await handle.stat({ bigint: true });
    const namedAfter = await fs.lstat(filePath, { bigint: true });
    const same = (a: typeof before, b: typeof before): boolean =>
      a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
    if (!same(namedBefore, before) || !same(before, after) || !same(after, namedAfter) || namedAfter.isSymbolicLink()) {
      throw new Error('CAPTURE_CHANGED_DURING_HASH');
    }
    return { sha256: hash.digest('hex'), size: Number(after.size), mtimeMs: Number(after.mtimeNs) / 1e6 };
  } finally {
    await handle.close();
  }
}
