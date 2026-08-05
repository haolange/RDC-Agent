/**
 * Shared filesystem / JSON / JSONL helpers for session storage stores.
 */

import * as fs from 'fs';
import * as path from 'path';
import { generateShortId } from '@shared/utils/id';

const DEEP_MERGE_FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export class StorageIo {
  ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  readJson<T>(filePath: string): T | null {
    let raw: string;
    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        return null;
      }
      throw new Error(
        `STORAGE_CORRUPT: failed to read JSON file: ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    try {
      return JSON.parse(raw) as T;
    } catch (parseError) {
      const bakPath = `${filePath}.bak`;
      try {
        if (fs.existsSync(bakPath)) {
          const bakRaw = fs.readFileSync(bakPath, 'utf-8');
          const restored = JSON.parse(bakRaw) as T;
          try {
            this.writeUtf8Atomic(filePath, bakRaw);
          } catch {
            // Return restored payload even if primary rewrite fails.
          }
          return restored;
        }
      } catch {
        // Bak missing or also corrupt — fall through to quarantine.
      }

      this.quarantineCorruptFile(filePath);
      throw new Error(
        `STORAGE_CORRUPT: failed to parse JSON file: ${filePath}: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
      );
    }
  }

  private quarantineCorruptFile(filePath: string): void {
    if (!fs.existsSync(filePath)) {
      return;
    }
    const corruptPath = `${filePath}.corrupt.${Date.now()}`;
    try {
      fs.renameSync(filePath, corruptPath);
    } catch {
      try {
        fs.copyFileSync(filePath, corruptPath);
        fs.rmSync(filePath, { force: true });
      } catch {
        // Best-effort quarantine only.
      }
    }
  }

  writeUtf8Atomic(filePath: string, content: string): void {
    this.ensureDir(path.dirname(filePath));
    const temporaryPath = `${filePath}.${process.pid}.${generateShortId()}.tmp`;
    fs.writeFileSync(temporaryPath, content, 'utf-8');
    try {
      fs.renameSync(temporaryPath, filePath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST' && code !== 'EPERM') {
        if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
        throw error;
      }

      // Windows-safe bak-swap: no rm-then-rename data-loss window.
      const bakTmpPath = `${filePath}.bak.tmp.${process.pid}.${generateShortId()}`;
      try {
        fs.renameSync(filePath, bakTmpPath);
      } catch (bakError) {
        if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
        throw bakError;
      }

      try {
        fs.renameSync(temporaryPath, filePath);
      } catch (finalError) {
        try {
          fs.renameSync(bakTmpPath, filePath);
        } catch {
          // Leave bakTmp in place for manual recovery.
        }
        if (fs.existsSync(temporaryPath)) fs.rmSync(temporaryPath, { force: true });
        throw finalError;
      }

      const durableBakPath = `${filePath}.bak`;
      try {
        if (fs.existsSync(durableBakPath)) {
          fs.rmSync(durableBakPath, { force: true });
        }
        fs.renameSync(bakTmpPath, durableBakPath);
      } catch {
        try {
          fs.rmSync(bakTmpPath, { force: true });
        } catch {
          // Best-effort bak cleanup.
        }
      }
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
      if (DEEP_MERGE_FORBIDDEN_KEYS.has(key)) {
        continue;
      }

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