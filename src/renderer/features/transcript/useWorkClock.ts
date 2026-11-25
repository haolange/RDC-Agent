import { useEffect, useState } from 'react';

/**
 * One clock for every running Working timer (the turn header, delegated Agents): a single 1 s interval that runs only
 * while something running listens, and hands every listener the same instant, so visible timers advance together.
 */
const TICK_MS = 1_000;
const listeners = new Set<(now: number) => void>();
let interval: number | undefined;

const listen = (listener: (now: number) => void): (() => void) => {
  listeners.add(listener);
  interval ??= window.setInterval(() => {
    const now = Date.now();
    for (const notify of listeners) notify(now);
  }, TICK_MS);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.clearInterval(interval);
      interval = undefined;
    }
  };
};

/** The shared current time while `running`; `undefined` once the timer it drives has settled. */
export function useWorkClock(running: boolean): number | undefined {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return undefined;
    setNow(Date.now());
    return listen(setNow);
  }, [running]);
  return running ? now : undefined;
}
