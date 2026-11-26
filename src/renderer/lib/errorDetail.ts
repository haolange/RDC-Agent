/**
 * The technical text of a failure, for the diagnostics layer only. Surfaces show a human sentence from the catalog
 * and put this underneath, never in its place.
 */
export function errorDetail(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  // JSON.stringify returns undefined for undefined, functions and symbols, though its type says string.
  return typeof reason === 'string' ? reason : ((JSON.stringify(reason) as string | undefined) ?? 'unknown');
}
