import type { ProviderConnectionErrorCode, ProviderConnectionErrorParams } from '@shared/types/settings';

/**
 * A connection failure the person can act on carries a code (and params) the renderer translates; the
 * message is the English technical fallback for logs and for failures without a code.
 */
export class ProviderConnectionError extends Error {
  constructor(
    message: string,
    readonly httpStatus?: number,
    readonly code?: ProviderConnectionErrorCode,
    readonly params?: ProviderConnectionErrorParams,
  ) { super(message); }
}

export function providerConnectionError(
  code: ProviderConnectionErrorCode,
  message: string,
  params?: ProviderConnectionErrorParams,
  httpStatus?: number,
): ProviderConnectionError {
  return new ProviderConnectionError(message, httpStatus, code, params);
}

export interface ParsedProviderError {
  error: string;
  errorCode?: ProviderConnectionErrorCode;
  errorParams?: ProviderConnectionErrorParams;
}

/** The failure as the connection result carries it: technical message plus, when known, its code. */
export function describeProviderError(error: unknown): ParsedProviderError {
  if (error instanceof ProviderConnectionError) {
    return {
      error: error.message,
      ...(error.code ? { errorCode: error.code } : {}),
      ...(error.params ? { errorParams: error.params } : {}),
    };
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return { error: 'The connection test timed out.', errorCode: 'timeout' };
  }
  if (error instanceof Error && error.message.trim()) return { error: error.message };
  return { error: 'The connection test failed.', errorCode: 'failed' };
}

/** The technical message alone, for account-auth diagnostics that keep their own wording. */
export function parseProviderError(error: unknown): string {
  return describeProviderError(error).error;
}
