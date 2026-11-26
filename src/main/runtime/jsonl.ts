/**
 * JSONL Utilities - JSONL (JSON Lines) read/write helpers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { StringDecoder } from 'node:string_decoder';
import { AppError } from '@shared/errors/appError';

export interface JsonlDiagnostic {
  line: number;
  error: string;
}

/** A final segment without its newline that is not a complete record: the remains of an interrupted append. */
export interface JsonlTornTail {
  offset: number;
  length: number;
}

export interface JsonlReadResult<T = unknown> {
  records: T[];
  diagnostics: JsonlDiagnostic[];
  tornTail?: JsonlTornTail;
}

export interface JsonlTailRepair {
  code: 'JSONL_TORN_TAIL';
  filePath: string;
  quarantinePath: string;
  length: number;
}

const tailRepairListeners = new Set<(repair: JsonlTailRepair) => void>();

/** Subscribes to torn-tail repairs so the owner can surface them; returns the unsubscribe function. */
export function onJsonlTailRepair(listener: (repair: JsonlTailRepair) => void): () => void {
  tailRepairListeners.add(listener);
  return () => tailRepairListeners.delete(listener);
}

/**
 * Read all records from a JSONL file. Each line is parsed as JSON and handed to `parse`, which throws when the value
 * is not a valid record. Mid-file lines that are not JSON or not a valid record are reported in diagnostics (not
 * silently skipped). A final unterminated segment that is not JSON is an interrupted append: it is returned as
 * `tornTail`, not as corruption, so the complete records before it stay readable. File-level I/O errors throw.
 */
export function readJsonl<T>(
  filePath: string,
  parse: (value: unknown) => T,
  select?: (record: T) => boolean,
): JsonlReadResult<T> {
  if (!fs.existsSync(filePath)) {
    return { records: [], diagnostics: [] };
  }

  const records: T[] = [];
  const diagnostics: JsonlDiagnostic[] = [];
  let lineNumber = 0;
  const accept = (value: unknown) => {
    let record: T;
    try {
      record = parse(value);
    } catch (error) {
      diagnostics.push({ line: lineNumber, error: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (!select || select(record)) records.push(record);
  };
  const consume = (line: string) => {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) return;
    const value = parseJsonValue(trimmed);
    if (value.ok) accept(value.value);
    else diagnostics.push({ line: lineNumber, error: value.error });
  };
  const ioError = (error: unknown) =>
    new Error(`Failed to read JSONL file: ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch (error) {
    throw ioError(error);
  }
  let tornTail: JsonlTornTail | undefined;
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let total = 0;
    let bytes: number;
    const read = () => {
      try {
        return fs.readSync(fd, buffer, 0, buffer.length, null);
      } catch (error) {
        throw ioError(error);
      }
    };
    while ((bytes = read()) > 0) {
      total += bytes;
      pending += decoder.write(buffer.subarray(0, bytes));
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        consume(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
      }
    }
    pending += decoder.end();
    if (pending.trim()) {
      const tail = parseJsonValue(pending.trim());
      if (tail.ok) {
        lineNumber += 1;
        accept(tail.value);
      } else {
        const length = Buffer.byteLength(pending, 'utf8');
        tornTail = { offset: total - length, length };
      }
    }
  } finally {
    fs.closeSync(fd);
  }

  return tornTail ? { records, diagnostics, tornTail } : { records, diagnostics };
}

function parseJsonValue(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Makes the file end on a record boundary before an append. A complete last record that only lacks its newline
 * gets one; an interrupted append is moved byte-for-byte into a sibling quarantine file (fsynced) and cut off.
 */
export function ensureJsonlRecordBoundary(filePath: string): void {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r+');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  try {
    const size = fs.fstatSync(fd).size;
    if (size === 0) return;
    const last = Buffer.alloc(1);
    fs.readSync(fd, last, 0, 1, size - 1);
    if (last[0] === 0x0a) return;
    const boundary = lastNewlineBefore(fd, size);
    const tail = Buffer.alloc(size - boundary);
    fs.readSync(fd, tail, 0, tail.length, boundary);
    if (parseJsonValue(tail.toString('utf8').trim()).ok) {
      fs.writeSync(fd, '\n', size);
      fs.fsyncSync(fd);
      return;
    }
    const quarantinePath = `${filePath}.torn-${Date.now()}`;
    const quarantine = fs.openSync(quarantinePath, 'wx');
    try {
      fs.writeSync(quarantine, tail);
      fs.fsyncSync(quarantine);
    } finally {
      fs.closeSync(quarantine);
    }
    fs.ftruncateSync(fd, boundary);
    fs.fsyncSync(fd);
    for (const listener of tailRepairListeners) {
      listener({ code: 'JSONL_TORN_TAIL', filePath, quarantinePath, length: tail.length });
    }
  } finally {
    fs.closeSync(fd);
  }
}

/** Offset just after the last newline in the file, or 0 when the file has none. */
function lastNewlineBefore(fd: number, size: number): number {
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let end = size;
  while (end > 0) {
    const start = Math.max(0, end - chunk.length);
    const length = end - start;
    fs.readSync(fd, chunk, 0, length, start);
    const index = chunk.subarray(0, length).lastIndexOf(0x0a);
    if (index >= 0) return start + index + 1;
    end = start;
  }
  return 0;
}

/**
 * Append one JSON record to a JSONL file. Only the last byte is read on the ordinary path; a file left without its
 * final newline by an interrupted append is brought back to a record boundary first.
 */
export function appendJsonl(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  ensureJsonlRecordBoundary(filePath);

  const serialized = `${JSON.stringify(data, null, 0)}\n`;
  fs.appendFileSync(filePath, serialized, 'utf-8');
}

/**
 * Append one JSON record and make it durable before returning: open, write the whole line, fsync, close. A record the
 * caller saw appended survives a crash or power loss right after, which is what a log read at the next launch needs.
 * Like `appendJsonl`, a file left without its final newline by an interrupted append is brought back to a record
 * boundary first.
 */
export function appendJsonlDurable(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  ensureJsonlRecordBoundary(filePath);
  const fd = fs.openSync(filePath, 'a');
  try {
    fs.writeSync(fd, `${JSON.stringify(data, null, 0)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Overwrite a JSONL file with the provided records.
 */
export function writeJsonl(filePath: string, items: unknown[]): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = items.length > 0 ? `${items.map((item) => JSON.stringify(item, null, 0)).join('\n')}\n` : '';
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function assertNoJsonlDiagnostics(filePath: string, diagnostics: JsonlDiagnostic[]): void {
  if (diagnostics.length === 0) return;
  const preview = diagnostics
    .slice(0, 3)
    .map((entry) => `line ${entry.line}: ${entry.error}`)
    .join('; ');
  throw new AppError('STORAGE_CORRUPT', `JSONL corruption in ${filePath}: ${preview}`, {
    params: { file: path.basename(filePath) },
  });
}
