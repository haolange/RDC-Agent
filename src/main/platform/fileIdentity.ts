import { promises as fs, type BigIntStats } from 'node:fs';

/**
 * File identity as an open handle reports it.
 *
 * A path stat and a handle stat of the same file are not comparable on every host: newer
 * Windows builds answer path stats through a different system call, so device, inode or
 * change time can differ between the two for one unchanged file. Identity comparisons
 * therefore use handle stats on both sides; path stats are only for type and link checks.
 */
export async function openedFileIdentity(filePath: string): Promise<BigIntStats> {
  const handle = await fs.open(filePath, 'r');
  try {
    return await handle.stat({ bigint: true });
  } finally {
    await handle.close();
  }
}

/** Same file and same bytes as far as metadata can tell: identity, size and both timestamps. */
export function sameFileState(left: BigIntStats, right: BigIntStats): boolean {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  );
}
