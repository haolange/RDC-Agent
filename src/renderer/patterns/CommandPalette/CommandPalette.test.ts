// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommandPalette } from './index';

vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
let host: HTMLDivElement;
let root: Root;
let opener: HTMLButtonElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 40, 20)] as unknown as DOMRectList);
  opener = document.createElement('button'); host = document.createElement('div');
  document.body.append(opener, host); opener.focus(); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); opener.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps Tab inside the palette, closes on Escape and returns focus to where it was', () => {
  const close = vi.fn();
  const render = (open: boolean) => act(() => root.render(createElement(CommandPalette, {
    commands: [], open, close, query: '', setQuery: () => undefined,
  })));
  render(true);
  const input = document.querySelector<HTMLInputElement>('.command-palette-input')!;
  expect(document.activeElement).toBe(input);
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })));
  expect(document.activeElement).toBe(input);
  act(() => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(close).toHaveBeenCalledOnce();
  render(false);
  expect(document.querySelector('.command-palette')).toBeNull();
  expect(document.activeElement).toBe(opener);
});
