import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import type { StorageIo } from '../StorageIo';

export const RUN_V2_BACKUP_DIR = 'migration-backups/run-v2';

export interface RunArchiveResult {
  archivePath: string;
  sha256: string;
  idempotent: boolean;
}

export function hashUtf8(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

export function archiveRunOriginalBytes(
  io: StorageIo,
  sessionPath: string,
  runId: string,
  sourceExt: 'json' | 'yaml',
  bytes: string,
): RunArchiveResult {
  const sha256 = hashUtf8(bytes);
  const archiveDir = path.join(sessionPath, RUN_V2_BACKUP_DIR, runId);
  const archivePath = path.join(archiveDir, `${sha256}.${sourceExt}`);
  io.ensureDir(archiveDir);
  if (fs.existsSync(archivePath)) {
    const existing = fs.readFileSync(archivePath, 'utf8');
    const existingHash = hashUtf8(existing);
    if (existingHash === sha256) {
      return { archivePath, sha256, idempotent: true };
    }
    throw new Error(
      `RUN_V2_ARCHIVE_CONFLICT: ${archivePath} already exists with a different hash.`,
    );
  }
  io.writeUtf8AtomicFsync(archivePath, bytes);
  const archived = fs.readFileSync(archivePath, 'utf8');
  if (hashUtf8(archived) !== sha256) {
    throw new Error(`RUN_V2_ARCHIVE_MISMATCH: archived bytes for ${runId} failed hash verification.`);
  }
  return { archivePath, sha256, idempotent: false };
}

export function isRunV2BackupPath(filePath: string): boolean {
  return filePath.replace(/\\/g, '/').includes(`/${RUN_V2_BACKUP_DIR}/`);
}
