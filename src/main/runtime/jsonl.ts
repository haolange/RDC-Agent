/**
 * JSONL Utilities - JSONL (JSON Lines) read/write helpers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { StringDecoder } from 'node:string_decoder';

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
 * Read all JSON records from a JSONL file.
 * Mid-file parse failures are reported in diagnostics (not silently skipped).
 * A final unterminated segment that does not parse is an interrupted append: it is returned as `tornTail`, not as
 * corruption, so the complete records before it stay readable. File-level I/O errors throw.
 */
export function readJsonl<T = unknown>(filePath: string, select?: (record: T) => boolean): JsonlReadResult<T> {
  if (!fs.existsSync(filePath)) {
    return { records: [], diagnostics: [] };
  }

  const records: T[] = [];
  const diagnostics: JsonlDiagnostic[] = [];
  let lineNumber = 0;
  const consume = (line: string) => {
    lineNumber += 1;
    const trimmed = line.trim();
    if (!trimmed) return;
    let record: T;
    try {
      record = JSON.parse(trimmed) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({ line: lineNumber, error: message });
      return;
    }
    if (!select || select(record)) records.push(record);
  };
  const ioError = (error: unknown) => new Error(`Failed to read JSONL file: ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  let fd: number;
  try { fd = fs.openSync(filePath, 'r'); } catch (error) { throw ioError(error); }
  let tornTail: JsonlTornTail | undefined;
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const decoder = new StringDecoder('utf8');
    let pending = '';
    let total = 0;
    let bytes: number;
    const read = () => {
      try { return fs.readSync(fd, buffer, 0, buffer.length, null); } catch (error) { throw ioError(error); }
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
      const tail = parseRecord<T>(pending);
      if (tail.ok) {
        lineNumber += 1;
        if (!select || select(tail.record)) records.push(tail.record);
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

function parseRecord<T>(text: string): { ok: true; record: T } | { ok: false } {
  try {
    return { ok: true, record: JSON.parse(text.trim()) as T };
  } catch {
    return { ok: false };
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
    if (parseRecord(tail.toString('utf8')).ok) {
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
 * Overwrite a JSONL file with the provided records.
 */
export function writeJsonl(filePath: string, items: unknown[]): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = items.length > 0
    ? `${items.map((item) => JSON.stringify(item, null, 0)).join('\n')}\n`
    : '';
  fs.writeFileSync(filePath, content, 'utf-8');
}

/**
 * Filter JSONL records using a predicate.
 * Throws when the file contains unparsable lines.
 */
export function filterJsonl<T = unknown>(
  filePath: string,
  predicate: (item: T) => boolean,
): T[] {
  const { records, diagnostics } = readJsonl<T>(filePath);
  assertNoJsonlDiagnostics(filePath, diagnostics);
  return records.filter(predicate);
}

/**
 * Count JSONL records.
 * Throws when the file contains unparsable lines.
 */
export function countJsonl(filePath: string): number {
  const { records, diagnostics } = readJsonl(filePath);
  assertNoJsonlDiagnostics(filePath, diagnostics);
  return records.length;
}

export function assertNoJsonlDiagnostics(filePath: string, diagnostics: JsonlDiagnostic[]): void {
  if (diagnostics.length === 0) return;
  const preview = diagnostics
    .slice(0, 3)
    .map((entry) => `line ${entry.line}: ${entry.error}`)
    .join('; ');
  throw new Error(`JSONL corruption in ${filePath}: ${preview}`);
}
