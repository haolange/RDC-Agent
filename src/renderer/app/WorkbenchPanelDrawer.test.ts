// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { popOverlayLayer, pushOverlayLayer } from '../lib/overlayStack';
import { WorkbenchPanelDrawer } from './WorkbenchPanelDrawer';

let root: Root;
let host: HTMLDivElement;
let trigger: HTMLButtonElement;
let frame: FrameRequestCallback | null;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  frame = null;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {
    frame = null;
  });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    new DOMRect(0, 0, 40, 20),
  ] as unknown as DOMRectList);
  trigger = document.createElement('button');
  host = document.createElement('div');
  document.body.append(trigger, host);
  trigger.focus();
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  trigger.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('traps both Tab boundaries, leaves Escape to a layer opened above it and restores the opening focus', () => {
  const close = vi.fn();
  const render = (open: boolean) =>
    act(() =>
      root.render(
        createElement(WorkbenchPanelDrawer, {
          open,
          onClose: close,
          title: 'Session',
          closeLabel: 'Close',
          'data-testid': 'drawer',
          keepMounted: true,
          children: createElement(
            'div',
            null,
            createElement('button', { id: 'last' }, 'Last'),
            createElement('input', { id: 'nested' }),
          ),
        }),
      ),
    );
  render(true);
  act(() => frame?.(0));
  const first = host.querySelector('button')!;
  const last = host.querySelector<HTMLInputElement>('#nested')!;
  expect(document.activeElement).toBe(first);
  act(() =>
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })),
  );
  expect(document.activeElement).toBe(last);
  // A menu or dialog opened from inside the drawer is the top layer and owns Escape until it closes.
  const nested = pushOverlayLayer();
  act(() => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(close).not.toHaveBeenCalled();
  popOverlayLayer(nested);
  act(() => last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(first);
  act(() => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(close).toHaveBeenCalledOnce();
  render(false);
  expect(document.activeElement).toBe(trigger);
  expect(host.firstElementChild?.hasAttribute('hidden')).toBe(true);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(close).toHaveBeenCalledOnce();
});
