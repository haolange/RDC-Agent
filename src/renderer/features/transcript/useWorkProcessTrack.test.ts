// @vitest-environment happy-dom
import React, { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useWorkProcessTrack } from './useWorkProcessTrack';

it('retains the logical start through windowing, measures reflow and releases dynamic styles', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  let resize = () => {};
  vi.stubGlobal('ResizeObserver', class { constructor(fn: () => void) { resize = fn; } observe() {} disconnect() {} });
  let rootTop = 100;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const top = this.dataset.position ? Number(this.dataset.position) : 0;
    return new DOMRect(0, rootTop + top, 400, this.dataset.workTrack ? 600 : 40);
  });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(function (this: HTMLElement) {
    return [this.getBoundingClientRect()] as unknown as DOMRectList;
  });
  const Harness = ({ windowed = false }: { windowed?: boolean }) => {
    const ref = useRef<HTMLDivElement>(null);
    useWorkProcessTrack(ref, 'first');
    const row = (id: string, position: number) => React.createElement('li', { key: id, 'data-position': position },
      React.createElement('span', { 'data-work-anchor': id }), React.createElement('div', { className: 'work-process-step-content' },
        React.createElement('button', { className: 'work-card-trigger', 'data-position': position }, id)));
    return React.createElement('div', { ref, 'data-work-track': 'true' }, React.createElement('ol', { 'data-virtualized': windowed ? 'true' : undefined },
      windowed ? React.createElement('li', { className: 'work-process-row-spacer' }) : row('first', 0), row('last', 200)));
  };
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  const css = () => document.adoptedStyleSheets.flatMap(sheet => Array.from(sheet.cssRules, rule => rule.cssText)).join('');
  try {
    await act(async () => root.render(React.createElement(Harness)));
    expect(css()).toMatch(/--work-track-start:\s*20px/);
    expect(css()).toMatch(/--work-track-display:\s*block/);
    rootTop = -300;
    await act(async () => root.render(React.createElement(Harness, { windowed: true })));
    await act(async () => resize());
    expect(host.querySelector('[data-work-anchor="first"]')).toBeNull();
    expect(css()).toMatch(/--work-track-start:\s*20px/);
    expect(css()).toMatch(/--work-track-display:\s*block/);
  } finally {
    await act(async () => root.unmount()); host.remove();
    expect(css()).not.toContain('--work-track-start');
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
