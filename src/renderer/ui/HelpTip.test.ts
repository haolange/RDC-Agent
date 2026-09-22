// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { HelpTip } from './HelpTip';

it('opens on keyboard focus and click, dismisses with Escape without dismissing its parent', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const parentEscape = vi.fn();
  window.addEventListener('keydown', parentEscape);
  try {
    await act(async () => root.render(createElement(HelpTip, { label: 'Accent', children: 'Composer color' })));
    const button = host.querySelector('button')!;
    await act(async () => button.focus());
    expect(document.querySelector('.ui-help-tip')?.textContent).toBe('Composer color');
    await act(async () => button.click());
    expect(button.getAttribute('aria-expanded')).toBe('true');
    await act(async () => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('.ui-help-tip')).toBeNull();
    expect(parentEscape).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button);
    await act(async () => button.click());
    await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(document.querySelector('.ui-help-tip')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    window.removeEventListener('keydown', parentEscape);
    vi.unstubAllGlobals();
  }
});
