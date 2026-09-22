// @vitest-environment happy-dom
import { act, createElement, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkbenchReadingLayoutContext } from './WorkbenchReadingLayout';
import { readingBounds, useReadingPanelGeometry } from './useReadingPanelGeometry';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });
it('aligns to an asymmetric composer and clamps to the visible work area', () => {
  expect(readingBounds(new DOMRect(280, 42, 960, 1000), new DOMRect(340, 750, 800, 120), 1600, 900))
    .toEqual({ left: 340, top: 42, width: 800, height: 858 });
  expect(readingBounds(new DOMRect(0, 42, 390, 780), new DOMRect(18, 700, 354, 90), 390, 844)?.width).toBe(354);
  expect(readingBounds(new DOMRect(), new DOMRect(), 390, 844)).toBeNull();
});
it('updates after resize and releases observers/listeners on close', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let resize!: () => void;
  let left = 310;
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { constructor(fn: () => void) { resize = fn; } observe() {} disconnect = disconnect; });
  let frame!: FrameRequestCallback;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frame = fn; return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.tagName === 'MAIN' ? new DOMRect(256, 42, 900, 800) : new DOMRect(left, 720, 700, 110);
  });
  const remove = vi.spyOn(window, 'removeEventListener');
  const Probe = () => { const result = useReadingPanelGeometry(); return createElement('output', result.style, String(result.ready)); };
  const Harness = () => {
    const workArea = useRef<HTMLElement>(null); const composerRail = useRef<HTMLDivElement>(null);
    return createElement(WorkbenchReadingLayoutContext.Provider, { value: { workArea, composerRail } },
      createElement('main', { ref: workArea }, createElement('div', { ref: composerRail })), createElement(Probe));
  };
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(Harness)));
  expect(host.querySelector('output')?.textContent).toBe('true');
  left = 420; await act(async () => { resize(); frame(0); });
  expect(document.adoptedStyleSheets.flatMap((sheet) => Array.from(sheet.cssRules, (rule) => rule.cssText)).join('')).toContain('--reading-left: 420px');
  await act(async () => root.unmount());
  expect(disconnect).toHaveBeenCalled(); expect(remove).toHaveBeenCalledWith('resize', expect.any(Function));
});
