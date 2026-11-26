/** Runs work that the first paint does not need once the renderer is idle (or shortly after, without idle callbacks). */
export function whenIdle(start: () => void): void {
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(start, { timeout: 2000 });
  else window.setTimeout(start, 200);
}
