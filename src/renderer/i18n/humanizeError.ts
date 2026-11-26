import { AppError, errorCodeOf, RendererIpcError } from '@shared/errors/appError';
import type { TranslationKey, Translator } from './messages';

/** One line for "Copy details": support-facing facts, never shown on a surface. */
export interface ErrorDetail {
  label: string;
  value: string;
}

/**
 * The sentence a person reads for a failure. Every registered code has its own copy (`check:i18n` enforces it), filled
 * from the error's params; a failure without a registered code reads as the caller's context copy ("Couldn't stop the
 * run"), else a generic line. Technical text is never the answer.
 */
export function humanizeError(error: unknown, t: Translator, contextKey?: TranslationKey): string {
  const code = errorCodeOf(error);
  if (code) {
    const params = error instanceof RendererIpcError || error instanceof AppError ? error.params : undefined;
    return t(`errors.${code}`, params);
  }
  return t(contextKey ?? 'errors.INTERNAL_ERROR');
}

/** The technical facts behind a failure, for the clipboard only. */
export function errorDetails(error: unknown): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  const code = errorCodeOf(error);
  if (code) details.push({ label: 'Code', value: code });
  if (error instanceof RendererIpcError) details.push({ label: 'Channel', value: error.channel });
  const technical =
    error instanceof RendererIpcError
      ? error.technical
      : error instanceof Error
        ? error.message
        : error === null || error === undefined
          ? undefined
          : String(error);
  if (technical) details.push({ label: 'Detail', value: technical });
  return details;
}
