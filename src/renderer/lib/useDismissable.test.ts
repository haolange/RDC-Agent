// @vitest-environment happy-dom
import { act, createElement, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useOverlayLayer } from './overlayStack';
import { useDismissable, type DismissReason } from './useDismissable';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

function Surface({
  id,
  open,
  layered,
  withInside,
  onDismiss,
}: {
  id: string;
  open: boolean;
  layered: boolean;
  withInside: boolean;
  onDismiss: (reason: DismissReason) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { layerId } = useOverlayLayer(open && layered, 'layout');
  useDismissable({
    open,
    layerId: layered ? layerId : undefined,
    inside: withInside ? () => [ref.current] : undefined,
    onDismiss,
  });
  return createElement('div', { id, ref }, createElement('button', { id: `${id}-inner` }, id));
}

const press = (target: Element) =>
  act(() => {
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
const escape = () =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  });

it('dismisses on a press outside its nodes and on Escape, and ignores presses inside', () => {
  const onDismiss = vi.fn();
  act(() =>
    root.render(createElement(Surface, { id: 'menu', open: true, layered: false, withInside: true, onDismiss })),
  );
  press(document.getElementById('menu-inner')!);
  expect(onDismiss).not.toHaveBeenCalled();
  press(document.body);
  escape();
  expect(onDismiss.mock.calls).toEqual([['outside'], ['escape']]);
});

it('lets only the topmost layer react, and without inside nodes only Escape dismisses', () => {
  const below = vi.fn();
  const above = vi.fn();
  act(() =>
    root.render(
      createElement(
        'div',
        {},
        createElement(Surface, { id: 'below', open: true, layered: true, withInside: true, onDismiss: below }),
        createElement(Surface, { id: 'above', open: true, layered: true, withInside: false, onDismiss: above }),
      ),
    ),
  );
  press(document.body);
  escape();
  expect(below).not.toHaveBeenCalled();
  expect(above.mock.calls).toEqual([['escape']]);
});
