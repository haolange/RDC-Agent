/**
 * JSONL Utilities - JSONL (JSON Lines) read/write helpers.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Read all JSON records from a JSONL file.
 */
export function readJsonl<T = unknown>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const results: T[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        results.push(JSON.parse(trimmed) as T);
      } catch {
        continue;
      }
    }
    return results;
  } catch (error) {
    console.error(`Failed to read JSONL file: ${filePath}`, error);
    return [];
  }
}

/**
 * Append one JSON record to a JSONL file.
 */
export function appendJsonl(filePath: string, data: unknown): boolean {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const serialized = JSON.stringify(data, null, 0);

    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath, 'utf-8');
      if (existing && !existing.endsWith('\n')) {
        fs.appendFileSync(filePath, '\n', 'utf-8');
      }
    }

    fs.appendFileSync(filePath, `${serialized}\n`, 'utf-8');
    return true;
  } catch (error) {
    console.error(`Failed to append to JSONL file: ${filePath}`, error);
    return false;
  }
}

/**
 * Overwrite a JSONL file with the provided records.
 */
export function writeJsonl(filePath: string, items: unknown[]): boolean {
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const lines = items.map((item) => JSON.stringify(item, null, 0));
    fs.writeFileSync(filePath, `${lines.join('\n')}\n`, 'utf-8');
    return true;
  } catch (error) {
    console.error(`Failed to write JSONL file: ${filePath}`, error);
    return false;
  }
}

/**
 * Filter JSONL records using a predicate.
 */
export function filterJsonl<T = unknown>(
  filePath: string,
  predicate: (item: T) => boolean
): T[] {
  const items = readJsonl<T>(filePath);
  return items.filter(predicate);
}

/**
 * Count JSONL records.
 */
export function countJsonl(filePath: string): number {
  return readJsonl(filePath).length;
}
