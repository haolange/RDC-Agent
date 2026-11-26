/**
 * Shared filesystem / JSON / JSONL helpers for session storage stores. Reads and writes go through the storage
 * primitives in `src/main/runtime/atomicFile.ts`: atomic durable writes, and validated reads that report a damaged
 * file on every read instead of turning it into an empty value.
 */

import * as fs from 'fs';
import { parse as parseYamlDocument } from 'yaml';
import { readValidatedSync, writeFileAtomicSync } from './atomicFile';
import { schemaValidationError, StorageSchemaError } from './storedDocument';
import type { ZodType } from 'zod';

const DEEP_MERGE_FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function validateDocument<T>(parsed: unknown, filePath: string, schema: ZodType<T>): T {
  const result = schema.safeParse(parsed);
  if (!result.success) throw schemaValidationError(filePath, result.error.issues);
  return result.data;
}

export class StorageIo {
  ensureDir(dirPath: string): void {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  readJson<T>(filePath: string, schema?: ZodType<T>): T | null {
    return readValidatedSync(filePath, (raw) => {
      const parsed: unknown = JSON.parse(raw);
      return schema ? validateDocument(parsed, filePath, schema) : (parsed as T);
    });
  }

  readYaml<T>(filePath: string, schema?: ZodType<T>): T | null {
    return readValidatedSync(filePath, (raw) => {
      const parsed: unknown = parseYamlDocument(raw);
      if (parsed == null) throw new StorageSchemaError(`${filePath} is empty or not a YAML document`);
      return schema ? validateDocument(parsed, filePath, schema) : (parsed as T);
    });
  }

  writeUtf8Atomic(filePath: string, content: string): void {
    writeFileAtomicSync(filePath, content);
  }

  writeBytesAtomic(filePath: string, content: Buffer): void {
    writeFileAtomicSync(filePath, content);
  }

  writeJsonAtomic(filePath: string, data: unknown): void {
    this.writeUtf8Atomic(filePath, JSON.stringify(data, null, 2));
  }

  writeJsonlAtomic(filePath: string, items: unknown[]): void {
    const content = items.length > 0 ? `${items.map((item) => JSON.stringify(item)).join('\n')}\n` : '';
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
