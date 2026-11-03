import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { ProjectInputRecord } from '@shared/types/session';
import { hashCaptureFile } from './replay/captureContentHash';
import { safePath } from './replay/replayFileSafety';

/** Explicit file registration only: no directory discovery and no write authority. */
export async function createExternalCaptureReference(filePath: string): Promise<ProjectInputRecord> {
  if (!path.isAbsolute(filePath) || path.extname(filePath).toLowerCase() !== '.rdc') {
    throw new Error('CAPTURE_REFERENCE_INVALID_PATH');
  }
  const absolute = path.resolve(filePath);
  await safePath(path.parse(absolute).root, absolute);
  const canonical = await fs.realpath(absolute);
  const before = await fs.lstat(canonical, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink > 1n) throw new Error('CAPTURE_UNSAFE_FILE');
  const handle = await fs.open(canonical, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.ctimeNs !== before.ctimeNs) {
      throw new Error('CAPTURE_CHANGED_DURING_HASH');
    }
    const header = Buffer.alloc(4);
    const { bytesRead } = await handle.read(header, 0, 4, 0);
    if (bytesRead !== 4 || header.toString('ascii') !== 'RDOC') throw new Error('CAPTURE_REFERENCE_INVALID_RDC');
  } finally { await handle.close(); }
  const hashed = await hashCaptureFile(canonical);
  const after = await fs.lstat(canonical, { bigint: true });
  if (before.dev !== after.dev || before.ino !== after.ino || before.ctimeNs !== after.ctimeNs) {
    throw new Error('CAPTURE_CHANGED_DURING_HASH');
  }
  return {
    inputId: `reference_${createHash('sha256').update(canonical).digest('hex').slice(0, 24)}`,
    source: 'external_reference', filePath: canonical, fileName: path.basename(canonical),
    discoveredAt: Date.now(), lastModifiedAt: hashed.mtimeMs, size: hashed.size,
    contentSha256: hashed.sha256,
    referenceIdentity: { device: after.dev.toString(), inode: after.ino.toString(), birthtimeNs: after.birthtimeNs.toString() },
  };
}

export async function verifyExternalCaptureReference(input: ProjectInputRecord): Promise<ProjectInputRecord> {
  if (input.source !== 'external_reference' || !input.referenceIdentity || !input.contentSha256) {
    throw new Error('CAPTURE_REFERENCE_INVALID_RECORD');
  }
  const current = await createExternalCaptureReference(input.filePath);
  if (current.filePath !== input.filePath || current.contentSha256 !== input.contentSha256
    || current.referenceIdentity?.device !== input.referenceIdentity.device
    || current.referenceIdentity?.inode !== input.referenceIdentity.inode
    || current.referenceIdentity?.birthtimeNs !== input.referenceIdentity.birthtimeNs) {
    throw new Error('CAPTURE_REFERENCE_CHANGED: explicitly register the current file again.');
  }
  return { ...current, inputId: input.inputId, discoveredAt: input.discoveredAt };
}
