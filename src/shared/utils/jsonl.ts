/**
 * JSONL Utilities - JSONL (JSON Lines) read/write helpers.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface JsonlDiagnostic {
  line: number;
  error: string;
}

export interface JsonlReadResult<T = unknown> {
  records: T[];
  diagnostics: JsonlDiagnostic[];
}

/**
 * Read all JSON records from a JSONL file.
 * Mid-file parse failures are reported in diagnostics (not silently skipped).
 * File-level I/O errors throw instead of returning an empty array.
 */
export function readJsonl<T = unknown>(filePath: string): JsonlReadResult<T> {
  if (!fs.existsSync(filePath)) {
    return { records: [], diagnostics: [] };
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read JSONL file: ${filePath}: ${message}`);
  }

  const lines = content.split('\n');
  const records: T[] = [];
  const diagnostics: JsonlDiagnostic[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index]!.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as T);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({ line: index + 1, error: message });
    }
  }

  return { records, diagnostics };
}

/**
 * Append one JSON record to a JSONL file.
 * Writers must keep the file newline-terminated (`\n` protocol); this no longer
 * reads the whole file to repair a missing trailing newline.
 */
export function appendJsonl(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

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
