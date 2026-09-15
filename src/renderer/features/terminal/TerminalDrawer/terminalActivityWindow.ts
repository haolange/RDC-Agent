export const TERMINAL_WINDOW_THRESHOLD = 48;
export const TERMINAL_ENTRY_ESTIMATE = 56;
export const TERMINAL_WINDOW_OVERSCAN = 8;

export function terminalActivityWindow(
  count: number,
  scrollTop: number,
  viewport: number,
  estimate = TERMINAL_ENTRY_ESTIMATE,
  overscan = TERMINAL_WINDOW_OVERSCAN,
): { start: number; end: number } {
  if (count <= TERMINAL_WINDOW_THRESHOLD) return { start: 0, end: count };
  const start = Math.max(0, Math.floor(scrollTop / estimate) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewport) / estimate) + overscan);
  return { start, end };
}
