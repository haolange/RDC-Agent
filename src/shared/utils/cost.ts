/**
 * Cost / pricing formatting helpers (USD).
 */

/**
 * Format an actual dollar cost with adaptive precision:
 * 4 decimals for small amounts (< $0.01), 2 decimals otherwise.
 */
export function formatUsdCost(value: number): string {
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  return `$${value.toFixed(digits)}`;
}

/**
 * Format a per-million-token pricing figure (dollars) as `$X.XX`.
 * The "/ 1M tokens" suffix is supplied by the caller via i18n.
 */
export function formatPricePerMillion(value: number): string {
  return `$${value.toFixed(2)}`;
}
