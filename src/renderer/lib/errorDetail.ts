/**
 * The technical text of a failure, for the diagnostics layer only. Surfaces show a human sentence from the catalog
 * and put this underneath, never in its place.
 */
export function errorDetail(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === 'string' ? reason : JSON.stringify(reason) ?? 'unknown';
}
