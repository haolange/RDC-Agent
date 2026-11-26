/**
 * The error every store raises for a stored document that does not match its strict schema. Persisted formats carry
 * no version marker: a document written in another format fails the same strict schema, and the error names the file.
 */

import { type ZodIssue } from 'zod';
import { AppError } from '@shared/errors/appError';

/** A stored document whose content does not match the strict schema of the store that reads it. */
export class StorageSchemaError extends AppError {
  declare readonly code: 'STORAGE_SCHEMA';

  constructor(detail: string) {
    super('STORAGE_SCHEMA', detail);
    this.name = 'StorageSchemaError';
  }
}

export function schemaValidationError(filePath: string, issues: readonly ZodIssue[]): StorageSchemaError {
  return new StorageSchemaError(
    `${filePath} failed runtime validation: ${issues.map((issue) => issue.message).join('; ')}`,
  );
}
