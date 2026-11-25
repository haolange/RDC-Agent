import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { AppError, errorCodeOf } from '@shared/errors/appError';
import { generateShortId } from '@shared/utils/id';
import { renameWithRetry, renameWithRetrySync, syncDirectory, syncDirectorySync } from '../platform/fileRename';

/**
 * The two storage primitives every persisted file goes through (docs/contracts/failure-model.md).
 *
 * Writes: temp file beside the target → write → fsync → rename over the target → fsync the directory. A reader
 * sees the old bytes or the new bytes, never a mix, and a completed write survives power loss.
 *
 * Reads: a missing file is `null`. A file that exists but cannot be parsed or validated is damaged: the read throws
 * `STORAGE_CORRUPT`, and keeps doing so on every read until the owner writes the file again — it never turns into
 * an empty value. One copy of the damaged bytes is kept beside it (named by content hash) so a later write cannot
 * destroy the evidence. A file this build cannot read (`STORAGE_SCHEMA_UNSUPPORTED`) passes through untouched;
 * an I/O failure is `STORAGE_UNREADABLE`, an availability failure that leaves the file as it is.
 */
export interface AtomicWriteOptions {
  /** File mode for a newly created file, for example 0o600 for credentials. */
  mode?: number;
}

const temporaryPathFor = (filePath: string): string => `${filePath}.${process.pid}.${generateShortId()}.tmp`;

export function writeFileAtomicSync(filePath: string, content: string | Uint8Array, options: AtomicWriteOptions = {}): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = temporaryPathFor(filePath);
  try {
    const fd = fs.openSync(temporaryPath, 'w', options.mode);
    try {
      fs.writeFileSync(fd, content);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    renameWithRetrySync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
  syncDirectorySync(directory);
}

export async function writeFileAtomic(filePath: string, content: string | Uint8Array, options: AtomicWriteOptions = {}): Promise<void> {
  const directory = path.dirname(filePath);
  await fs.promises.mkdir(directory, { recursive: true });
  const temporaryPath = temporaryPathFor(filePath);
  try {
    const handle = await fs.promises.open(temporaryPath, 'w', options.mode);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(temporaryPath, filePath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true });
    throw error;
  }
  await syncDirectory(directory);
}

/** Copies `source` to `target` with the same guarantees as a write: the target is the old file or the full copy. */
export function copyFileAtomicSync(source: string, target: string): void {
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = temporaryPathFor(target);
  try {
    fs.copyFileSync(source, temporaryPath);
    const fd = fs.openSync(temporaryPath, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    renameWithRetrySync(temporaryPath, target);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
  syncDirectorySync(directory);
}

/** Reads `filePath` and hands its text to `parse`, which throws when the content is not a valid document. */
export function readValidatedSync<T>(filePath: string, parse: (raw: string) => T): T | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new AppError('STORAGE_UNREADABLE', `${filePath}: ${error instanceof Error ? error.message : String(error)}`, {
      cause: error,
      params: { file: path.basename(filePath) },
    });
  }
  try {
    return parse(raw);
  } catch (error) {
    if (errorCodeOf(error) === 'STORAGE_SCHEMA_UNSUPPORTED') throw error;
    const keptAt = keepDamagedCopy(filePath, raw);
    throw new AppError(
      'STORAGE_CORRUPT',
      `${filePath} is damaged (copy kept at ${keptAt}): ${error instanceof Error ? error.message : String(error)}`,
      { cause: error, params: { file: path.basename(filePath) } },
    );
  }
}

/** Parses JSON and validates it; the parser for `readValidatedSync` when the document is plain JSON. */
export function parseJsonWith<T>(validate: (value: unknown) => T): (raw: string) => T {
  return (raw) => validate(JSON.parse(raw) as unknown);
}

function keepDamagedCopy(filePath: string, raw: string): string {
  const copyPath = `${filePath}.corrupt-${createHash('sha256').update(raw).digest('hex').slice(0, 12)}`;
  if (!fs.existsSync(copyPath)) writeFileAtomicSync(copyPath, raw);
  return copyPath;
}
