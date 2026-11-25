import { errorCodeOf, RendererIpcError } from '@shared/errors/appError';
import { errorCategory } from '@shared/errors/errorCodes';
import { englishTranslations, type TranslationKey, type Translator } from './messages';

/** One line for "Copy details": support-facing facts, never shown on a surface. */
export interface ErrorDetail {
  label: string;
  value: string;
}

/**
 * The sentence a person reads for a failure. Order: the code's own copy, then the caller's context copy ("Couldn't
 * stop the run"), then the code's failure class, then a generic line. Technical text is never the answer.
 */
export function humanizeError(error: unknown, t: Translator, contextKey?: TranslationKey): string {
  const code = errorCodeOf(error);
  if (code) {
    const key = `errors.${code}`;
    if (Object.hasOwn(englishTranslations, key)) {
      return t(key as TranslationKey, error instanceof RendererIpcError ? error.params : undefined);
    }
  }
  if (contextKey) return t(contextKey);
  return t(code ? `errors.category.${errorCategory(code)}` : 'errors.INTERNAL_ERROR');
}

/** The technical facts behind a failure, for the clipboard only. */
export function errorDetails(error: unknown): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  const code = errorCodeOf(error);
  if (code) details.push({ label: 'Code', value: code });
  if (error instanceof RendererIpcError) details.push({ label: 'Channel', value: error.channel });
  const technical = error instanceof RendererIpcError ? error.technical
    : error instanceof Error ? error.message
      : error === null || error === undefined ? undefined : String(error);
  if (technical) details.push({ label: 'Detail', value: technical });
  return details;
}
