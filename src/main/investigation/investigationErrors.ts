import { ZodError } from 'zod';
import { SessionArtifactError } from '@shared/types/sessionArtifact';

export const INVESTIGATION_ERROR_CODES = [
  'INVESTIGATION_SESSION_DENIED',
  'INVESTIGATION_KIND_UNKNOWN',
  'INVESTIGATION_SCHEMA_INVALID',
  'INVESTIGATION_READY_DENIED',
  'INVESTIGATION_REF_UNRESOLVED',
  'INVESTIGATION_HASH_MISMATCH',
  'INVESTIGATION_INVARIANT_VIOLATION',
  'INVESTIGATION_NOT_FOUND',
  'INVESTIGATION_OPAQUE_PAYLOAD_DENIED',
  'INVESTIGATION_INDEX_CORRUPT',
  'INVESTIGATION_INDEX_MISSING',
  'INVESTIGATION_DUPLICATE_ID',
  'INVESTIGATION_STORAGE_FAILED',
  'INVESTIGATION_DEGRADED',
] as const;

export type InvestigationErrorCode = (typeof INVESTIGATION_ERROR_CODES)[number];

export class InvestigationError extends Error {
  readonly code: InvestigationErrorCode;
  readonly invariantId?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: InvestigationErrorCode,
    message?: string,
    extras?: { invariantId?: string; details?: Record<string, unknown> },
  ) {
    const suffix = extras?.invariantId ? ` [${extras.invariantId}]` : '';
    super((message ? `${code}: ${message}` : code) + suffix);
    this.name = 'InvestigationError';
    this.code = code;
    this.invariantId = extras?.invariantId;
    this.details = extras?.details;
  }
}

export function toInvestigationError(error: unknown): InvestigationError {
  if (error instanceof InvestigationError) return error;
  if (error instanceof ZodError) {
    return new InvestigationError('INVESTIGATION_SCHEMA_INVALID', error.message);
  }
  if (error instanceof SessionArtifactError) {
    return new InvestigationError('INVESTIGATION_STORAGE_FAILED', error.message, {
      details: { artifactCode: error.code },
    });
  }
  return new InvestigationError(
    'INVESTIGATION_STORAGE_FAILED',
    error instanceof Error ? error.message : String(error),
  );
}

export function isInvestigationStoreDegraded(error: unknown): boolean {
  if (!(error instanceof InvestigationError)) return false;
  return error.code === 'INVESTIGATION_DEGRADED'
    || error.code === 'INVESTIGATION_INDEX_CORRUPT'
    || error.code === 'INVESTIGATION_INDEX_MISSING';
}
