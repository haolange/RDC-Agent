// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Popover } from './Popover';

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 40, 20)] as unknown as DOMRectList);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function Sample({ label }: { label?: string }) {
  const [open, setOpen] = useState(false);
  return createElement('div', {},
    createElement(Popover, {
      open, onOpenChange: setOpen, label,
      trigger: createElement('button', { type: 'button' }, 'Filters'),
      children: [createElement('button', { key: 'one', id: 'one' }, 'One'), createElement('button', { key: 'two', id: 'two' }, 'Two')],
    }),
    createElement('button', { id: 'after' }, 'After'));
}

const tab = (target: Element, shiftKey = false) => act(() => {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }));
});

it('is a named dialog that takes focus on open and joins the Tab order right after its trigger', () => {
  act(() => root.render(createElement(Sample)));
  const trigger = host.querySelector('button')!;
  act(() => { trigger.focus(); trigger.click(); });
  const dialog = document.querySelector<HTMLElement>('.ui-popover')!;
  expect(dialog.getAttribute('role')).toBe('dialog');
  expect(dialog.getAttribute('aria-labelledby')).toBe(trigger.id);
  expect(trigger.getAttribute('aria-controls')).toBe(dialog.id);
  const [one, two] = [document.getElementById('one')!, document.getElementById('two')!];
  expect(document.activeElement).toBe(one);

  tab(one, true);
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  tab(trigger);
  expect(document.activeElement).toBe(one);

  two.focus();
  tab(two);
  // Closed, with focus on the trigger so the native Tab continues to whatever follows it.
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(trigger);
});

it('takes an explicit name when the trigger does not name the surface', () => {
  act(() => root.render(createElement(Sample, { label: 'Devices' })));
  act(() => host.querySelector('button')!.click());
  const dialog = document.querySelector<HTMLElement>('.ui-popover')!;
  expect(dialog.getAttribute('aria-label')).toBe('Devices');
  expect(dialog.hasAttribute('aria-labelledby')).toBe(false);
});
