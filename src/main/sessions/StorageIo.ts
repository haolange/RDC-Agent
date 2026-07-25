/**
 * Shared filesystem / JSON / JSONL helpers for session storage stores.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateShortId } from '@shared/utils/id';

export class StorageIo {
  ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  readJson<T>(filePath: string): T | null {
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    } catch (error) {
      console.error(`Failed to read JSON file: ${filePath}`, error);
      return null;
    }
  }

  writeJson(filePath: string, data: unknown): void {
    this.ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  writeUtf8Atomic(filePath: string, content: string): void {
    this.ensureDir(path.dirname(filePath));
    const temporaryPath = `${filePath}.${process.pid}.${generateShortId()}.tmp`;
    fs.writeFileSync(temporaryPath, content, 'utf-8');
    try {
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  writeJsonAtomic(filePath: string, data: unknown): void {
    this.writeUtf8Atomic(filePath, JSON.stringify(data, null, 2));
  }

  writeJsonlAtomic(filePath: string, items: unknown[]): void {
    const content = items.length > 0
      ? `${items.map((item) => JSON.stringify(item)).join('\n')}\n`
      : '';
    this.writeUtf8Atomic(filePath, content);
  }

  deepMerge<T extends Record<string, unknown>>(base: T, patch: Record<string, unknown>): T {
    const output: Record<string, unknown> = { ...base };

    for (const [key, value] of Object.entries(patch)) {
      if (Array.isArray(value)) {
        output[key] = value;
        continue;
      }

      if (value && typeof value === 'object') {
        const existingValue = output[key];
        output[key] = this.deepMerge(
          (existingValue && typeof existingValue === 'object' && !Array.isArray(existingValue)
            ? existingValue
            : {}) as Record<string, unknown>,
          value as Record<string, unknown>,
        );
        continue;
      }

      output[key] = value;
    }

    return output as T;
  }
}
