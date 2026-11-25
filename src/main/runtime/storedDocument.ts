/**
 * Stored-document validation shared by every store: schema-version checks, ordered migrations and the
 * StorageSchemaError a damaged, invalid or newer-than-supported document raises.
 */

import { type ZodIssue, type ZodType } from 'zod';
import { AppError } from '@shared/errors/appError';
import type { StorageIo } from './StorageIo';

/** A stored document that is unreadable, invalid, or written by a newer schema than this build supports. */
export class StorageSchemaError extends AppError {
  declare readonly code: 'STORAGE_SCHEMA' | 'STORAGE_SCHEMA_UNSUPPORTED' | 'STORAGE_CORRUPT';

  constructor(code: StorageSchemaError['code'], detail: string) {
    super(code, detail);
    this.name = 'StorageSchemaError';
  }
}

/**
 * A schema rejection. A refinement that recognises a document from another store version marks its issue with
 * `params.storageCode: 'STORAGE_SCHEMA_UNSUPPORTED'`, which callers keep visible instead of quarantining.
 */
export function schemaValidationError(filePath: string, issues: readonly ZodIssue[]): StorageSchemaError {
  const unsupported = issues.some((issue) => issue.code === 'custom' && issue.params?.storageCode === 'STORAGE_SCHEMA_UNSUPPORTED');
  return new StorageSchemaError(
    unsupported ? 'STORAGE_SCHEMA_UNSUPPORTED' : 'STORAGE_SCHEMA',
    `${filePath} failed runtime validation: ${issues.map((issue) => issue.message).join('; ')}`,
  );
}

export function readCurrentStoredJson<T>(
  io: StorageIo,
  filePath: string,
  schemaVersion: string,
  schema: ZodType<T>,
): T | null {
  const raw = io.readJson<unknown>(filePath);
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || (raw as { schemaVersion?: unknown }).schemaVersion !== schemaVersion) {
    throw new StorageSchemaError('STORAGE_SCHEMA_UNSUPPORTED', `${filePath} requires schemaVersion ${schemaVersion}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw schemaValidationError(filePath, parsed.error.issues);
  }
  return parsed.data;
}

export interface StorageMigration<T> {
  schemaVersion: string;
  schema: ZodType<T>;
  migrate?: (raw: unknown) => unknown;
}

function readSchemaVersion(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.schemaVersion === 'string') return record.schemaVersion;
  if (typeof record.schema_version === 'string') return record.schema_version;
  if (typeof record.schemaVersion === 'number') return String(record.schemaVersion);
  if (typeof record.schema_version === 'number') return String(record.schema_version);
  return null;
}

export const CURRENT_STORE_SCHEMA_VERSION = '1';

export function assertNoUnsupportedSchemaVersion(
  raw: unknown,
  currentVersion: string,
  filePath: string,
): void {
  const version = readSchemaVersion(raw);
  if (version === null) return;
  const numeric = Number(version);
  const currentNumeric = Number(currentVersion);
  if (Number.isFinite(numeric) && Number.isFinite(currentNumeric) && numeric > currentNumeric) {
    throw new StorageSchemaError(
      'STORAGE_SCHEMA_UNSUPPORTED', `${filePath} has schemaVersion ${version}; supported up to ${currentVersion}`,
    );
  }
}

export function parseStoredDocument<T>(
  raw: unknown,
  migrations: readonly StorageMigration<T>[],
  filePath: string,
): T {
  if (migrations.length === 0) {
    throw new StorageSchemaError('STORAGE_SCHEMA', `no migrations registered for ${filePath}`);
  }
  const current = migrations[migrations.length - 1]!;
  let version = readSchemaVersion(raw);
  if (version === null) {
    if (migrations.some((entry) => entry.schemaVersion === '0')) {
      version = '0';
    } else {
      throw new StorageSchemaError('STORAGE_SCHEMA', `missing schemaVersion in ${filePath}`);
    }
  }

  const known = migrations.find((entry) => entry.schemaVersion === version);
  if (!known) {
    const knownVersions = migrations.map((entry) => entry.schemaVersion);
    const numeric = Number(version);
    const currentNumeric = Number(current.schemaVersion);
    if (Number.isFinite(numeric) && Number.isFinite(currentNumeric) && numeric > currentNumeric) {
      throw new StorageSchemaError(
        'STORAGE_SCHEMA_UNSUPPORTED', `${filePath} has schemaVersion ${version}; supported up to ${current.schemaVersion}`,
      );
    }
    throw new StorageSchemaError(
      'STORAGE_SCHEMA', `unknown schemaVersion ${version} in ${filePath} (known: ${knownVersions.join(', ')})`,
    );
  }

  let candidate: unknown = raw;
  const startIndex = migrations.findIndex((entry) => entry.schemaVersion === version);
  for (let index = startIndex; index < migrations.length; index += 1) {
    const step = migrations[index]!;
    if (step.migrate && index < migrations.length - 1) {
      candidate = step.migrate(candidate);
    }
  }

  const parsed = current.schema.safeParse(candidate);
  if (!parsed.success) {
    throw schemaValidationError(filePath, parsed.error.issues);
  }
  return parsed.data;
}
