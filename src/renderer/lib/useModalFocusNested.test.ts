// @vitest-environment happy-dom
import { act, createElement, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useOverlayLayer } from './overlayStack';
import { useModalFocus } from './useModalFocus';

function Layer({
  open,
  busy,
  onClose,
  children,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  children?: unknown;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { layerId } = useOverlayLayer(open);
  useModalFocus({ open, containerRef: ref, onClose, busy, layerId });
  return open ? createElement('div', { ref }, children as never) : null;
}

it('closes only the topmost layer when the inner layer unmounts before the outer listener runs', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const closeOuter = vi.fn();
  let setters: { inner: (open: boolean) => void; busy: (busy: boolean) => void } | null = null;
  function Harness() {
    const [innerOpen, setInnerOpen] = useState(false);
    const [busy, setBusy] = useState(true);
    setters = { inner: setInnerOpen, busy: setBusy };
    // A real keypress lets React flush between document listeners; flushSync reproduces that here.
    return createElement(
      Layer,
      { open: true, busy, onClose: closeOuter },
      createElement(Layer, { open: innerOpen, busy: false, onClose: () => flushSync(() => setInnerOpen(false)) }),
    );
  }
  try {
    await act(async () => root.render(createElement(Harness)));
    await act(async () => setters!.inner(true));
    // The outer layer's busy flag flips after the inner layer opened, so its listener now runs second.
    await act(async () => setters!.busy(false));
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })),
    );
    expect(closeOuter).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it('takes focus back into the dialog when busy disables the focused control, whatever the render count', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let setBusy: ((busy: boolean) => void) | null = null;
  function Dialog() {
    const ref = useRef<HTMLDivElement>(null);
    const [busy, setBusyState] = useState(false);
    setBusy = setBusyState;
    const { layerId } = useOverlayLayer(true);
    // A fresh close handler on every render, as dialog owners pass one.
    useModalFocus({ open: true, containerRef: ref, onClose: () => undefined, busy, layerId });
    return createElement(
      'div',
      { ref, tabIndex: -1, 'data-testid': 'dialog' },
      createElement('button', { type: 'button', disabled: busy, 'data-testid': 'action' }, 'Preview'),
    );
  }
  try {
    await act(async () => root.render(createElement(Dialog)));
    const action = host.querySelector<HTMLButtonElement>('[data-testid="action"]')!;
    action.focus();
    await act(async () => setBusy!(true));
    // The disabled control dropped focus; the dialog holds it, not the page.
    expect(document.activeElement).toBe(host.querySelector('[data-testid="dialog"]'));
    await act(async () => setBusy!(false));
    await act(async () => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    expect(document.activeElement).toBe(host.querySelector('[data-testid="dialog"]'));
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
