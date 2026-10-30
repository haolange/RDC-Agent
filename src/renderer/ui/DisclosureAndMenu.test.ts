// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Details } from './Details';
import { ContextMenu } from './ContextMenu';
import { popOverlayLayer, pushOverlayLayer } from '../lib/overlayStack';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('keeps independent disclosure drafts mounted across controlled collapse and expansion', async () => {
  const render = (open: boolean) => root.render(createElement('div', {},
    createElement(Details, { summary: 'First', open, variant: 'panel' }, createElement('input', { defaultValue: 'draft' })),
    createElement(Details, { summary: 'Second', open: true }, 'Other')));
  await act(async () => render(true));
  const input = host.querySelector('input')!;
  input.value = 'unsaved changes';
  await act(async () => render(false));
  expect(host.querySelectorAll('details')[1].open).toBe(true);
  expect(host.querySelector('input')).toBe(input);
  await act(async () => render(true));
  expect(input.value).toBe('unsaved changes');
});

it('navigates enabled context actions, reserves Escape for the top layer, and restores focus', async () => {
  const select = vi.fn();
  function Sample() {
    const [open, setOpen] = useState(false);
    return createElement('div', {}, createElement('button', { onClick: () => setOpen(true) }, 'Open'),
      open ? createElement(ContextMenu, { x: 100, y: 100, onClose: () => setOpen(false), onSelect: select,
        items: [{ type: 'command', id: 'copy', label: 'Copy', shortcut: '', disabled: false },
          { type: 'command', id: 'cut', label: 'Cut', shortcut: '', disabled: true },
          { type: 'command', id: 'paste', label: 'Paste', shortcut: '', disabled: false }] }) : null);
  }
  await act(async () => root.render(createElement(Sample)));
  const trigger = host.querySelector('button')!;
  await act(async () => { trigger.focus(); trigger.click(); });
  expect(document.activeElement?.textContent).toBe('Copy');
  const key = async (value: string) => act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
  await key('ArrowDown'); expect(document.activeElement?.textContent).toBe('Paste');
  await key('Enter'); expect(select).toHaveBeenCalledWith('paste');
  let nested = 0;
  await act(async () => { nested = pushOverlayLayer(); });
  await key('Escape'); expect(document.querySelector('[role="menu"]')).not.toBeNull();
  await act(async () => popOverlayLayer(nested));
  await key('Escape'); expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
