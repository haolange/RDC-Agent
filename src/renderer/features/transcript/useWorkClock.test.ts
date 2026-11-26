// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useWorkClock } from './useWorkClock';

const seen = new Map<string, Array<number | undefined>>();
const Timer = ({ id, running }: { id: string; running: boolean }) => {
  const now = useWorkClock(running);
  seen.set(id, [...(seen.get(id) ?? []), now]);
  return null;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  seen.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('drives every running Working timer from one 1 s interval and stops it when none runs', async () => {
  const intervals = vi.spyOn(window, 'setInterval');
  const cleared = vi.spyOn(window, 'clearInterval');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const render = (header: boolean, subagent: boolean) =>
    act(async () =>
      root.render(
        createElement(
          'div',
          null,
          createElement(Timer, { id: 'header', running: header }),
          createElement(Timer, { id: 'subagent', running: subagent }),
        ),
      ),
    );
  try {
    await render(true, true);
    expect(intervals).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(seen.get('header')?.at(-1)).toBe(11_000);
    expect(seen.get('subagent')?.at(-1)).toBe(11_000);
    // A settled timer reads undefined and leaves the clock to the one still running.
    await render(true, false);
    expect(seen.get('subagent')?.at(-1)).toBeUndefined();
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(seen.get('header')?.at(-1)).toBe(12_000);
    expect(intervals).toHaveBeenCalledTimes(1);
    await render(false, false);
    expect(cleared).toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
