// @vitest-environment happy-dom
import { act, createElement, StrictMode, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ComposerMenuRegistryProvider, useComposerMenu } from './useComposerMenuRegistry';
import { useEffortPopupLayout } from './useEffortPopupLayout';
import { useMaxVisualController } from './useMaxVisualController';

let root: Root;
let host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let frameId = 0;
const observers: { disconnected: boolean }[] = [];
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frames = new Map(); observers.length = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.stubGlobal('ResizeObserver', class {
    disconnected = false;
    constructor() { observers.push(this); }
    observe() {}
    disconnect() { this.disconnected = true; }
  });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  expect(frames.size).toBe(0);
  expect(observers.every(observer => observer.disconnected)).toBe(true);
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function Menu({ id }: { id: 'agent' | 'usage' }) {
  const menu = useComposerMenu(id);
  return createElement('div', { ref: menu.setRoot },
    createElement('button', { ref: menu.setTrigger, onClick: menu.toggle, 'data-menu': id, 'aria-expanded': menu.open }, id),
    menu.open ? createElement('span', { 'data-panel': id }, id) : null);
}
function Menus({ scope }: { scope: string }) {
  return createElement(StrictMode, null, createElement(ComposerMenuRegistryProvider, { key: scope,
    children: [createElement(Menu, { key: 'agent', id: 'agent' }), createElement(Menu, { key: 'usage', id: 'usage' })],
  }));
}

describe('Composer lifecycle', () => {
  it('keeps menus exclusive, dismisses outside, and cancels queued focus on session change', () => {
    act(() => root.render(createElement(Menus, { scope: 'session-a' })));
    const click = (id: string) => act(() => host.querySelector<HTMLButtonElement>(`[data-menu="${id}"]`)!.click());
    click('agent'); click('usage');
    expect(host.querySelector('[data-panel="agent"]')).toBeNull();
    expect(host.querySelector('[data-panel="usage"]')).not.toBeNull();
    act(() => window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(host.querySelector('[data-panel]')).toBeNull();
    expect(frames.size).toBe(1);
    act(() => root.render(createElement(Menus, { scope: 'session-b' })));
    expect(frames.size).toBe(0);
    expect(host.querySelector('[data-panel]')).toBeNull();
    click('agent');
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(host.querySelector('[data-panel]')).toBeNull();
  });

  it('releases popup observers and settling frames on close and scope unmount', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 280, height: 60, left: 0, right: 280, top: 0, bottom: 60, x: 0, y: 0, toJSON() {} });
    function Popup({ open }: { open: boolean }) {
      const menuRef = useRef<HTMLDivElement>(null); const popupRef = useRef<HTMLDivElement>(null); const trackRef = useRef<HTMLDivElement>(null);
      const layout = useEffortPopupLayout({ open, menuRef, popupRef, trackRef, trackObserveKey: 'model' });
      return createElement('div', { ref: menuRef }, createElement('div', { ref: popupRef }, createElement('div', { ref: trackRef, 'data-ready': layout.positionTransitionsReady })));
    }
    act(() => root.render(createElement(StrictMode, null, createElement(Popup, { open: true }))));
    expect(frames.size).toBe(1);
    act(() => root.render(createElement(StrictMode, null, createElement(Popup, { open: false }))));
    expect(frames.size).toBe(0);
    expect(observers.every(observer => observer.disconnected)).toBe(true);
    act(() => root.render(createElement(StrictMode, null, createElement(Popup, { open: true }))));
    expect(frames.size).toBe(1);
  });

  it('invalidates a closed Max timeline so late completion cannot reanimate it', () => {
    let controller!: ReturnType<typeof useMaxVisualController>;
    function Max({ open }: { open: boolean }) {
      controller = useMaxVisualController({ open, isDragging: false, displayLevel: 'max', selectedLevel: 'max' });
      return null;
    }
    act(() => root.render(createElement(StrictMode, null, createElement(Max, { open: true }))));
    const revision = controller.maxTimeline.revision;
    expect(controller.showMaxTrack).toBe(true);
    act(() => root.render(createElement(StrictMode, null, createElement(Max, { open: false }))));
    act(() => controller.completeMaxTimeline(revision));
    expect(controller.maxTimeline.phase).toBe('idle');
    expect(controller.showMaxTrack).toBe(false);
  });
});
