// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLayoutStore } from '../stores/layoutStore';
import { useWorkbenchLayout } from './useWorkbenchLayout';

let layout: ReturnType<typeof useWorkbenchLayout>;
let seen: boolean[] = [];
const Harness = () => {
  layout = useWorkbenchLayout(true);
  seen.push(layout.columnsAnimating);
  return null;
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  seen = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('animates the shell columns for a sidebar toggle only, never for a restored or resized layout', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Harness)));
    // A restored layout (settings arriving after boot) lands in place.
    await act(async () => useLayoutStore.setState({ rightPanelWidth: 300, leftSidebarWidth: 240 }));
    expect(seen.every((animating) => !animating)).toBe(true);
    await act(async () => layout.animateColumns());
    expect(layout.columnsAnimating).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(layout.columnsAnimating).toBe(false);
    // The transition finishing early ends the animation at once.
    await act(async () => layout.animateColumns());
    await act(async () => layout.settleColumns());
    expect(layout.columnsAnimating).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
