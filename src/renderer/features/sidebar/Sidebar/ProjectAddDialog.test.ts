// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectAddDialog } from './ProjectAddDialog';

const browse = vi.hoisted(() => vi.fn());
vi.mock('../../../platform/projectDirectory', () => ({ browseProjectDirectory: browse }));
vi.mock('../../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); browse.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount()); host.remove();
  Reflect.deleteProperty(window, '__RDC_AGENT_BROWSER_APP_BRIDGE__'); vi.unstubAllGlobals();
});
const button = (name: string) => [...document.querySelectorAll('button')].find(b => b.textContent === name)!;
function fill(value: string) {
  const input = document.querySelector('input')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
it('lets Browser users enter the exact project path without opening a native chooser', async () => {
  Object.defineProperty(window, '__RDC_AGENT_BROWSER_APP_BRIDGE__', { configurable: true, value: true });
  const add = vi.fn(async () => undefined), close = vi.fn();
  act(() => root.render(createElement(ProjectAddDialog, { onAdd: add, onClose: close })));
  expect(button('sidebar.browseDirectory')).toBeUndefined();
  expect(button('sidebar.addProject').disabled).toBe(true);
  act(() => fill('D:/isolated/project'));
  await act(async () => button('sidebar.addProject').click());
  expect(add).toHaveBeenCalledExactlyOnceWith('D:/isolated/project');
  expect(close).toHaveBeenCalledTimes(1); expect(browse).not.toHaveBeenCalled();
});
it('retains the draft and exposes failure, while cancellation does not add a project', async () => {
  const add = vi.fn(async () => { throw new Error('directory unavailable'); }), close = vi.fn();
  act(() => root.render(createElement(ProjectAddDialog, { onAdd: add, onClose: close })));
  act(() => fill('D:/missing'));
  await act(async () => button('sidebar.addProject').click());
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('directory unavailable');
  expect(document.querySelector('input')?.value).toBe('D:/missing'); expect(close).not.toHaveBeenCalled();
  act(() => button('dialog.cancel').click()); expect(add).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1);
});
it('preserves desktop directory browsing and cancellation without adding a project', async () => {
  const add = vi.fn(async () => undefined), close = vi.fn(); browse.mockResolvedValueOnce(null).mockResolvedValueOnce('D:/selected');
  act(() => root.render(createElement(ProjectAddDialog, { onAdd: add, onClose: close })));
  await act(async () => button('sidebar.browseDirectory').click());
  expect(button('sidebar.addProject').disabled).toBe(true); expect(add).not.toHaveBeenCalled();
  await act(async () => button('sidebar.browseDirectory').click());
  expect(document.querySelector('input')?.value).toBe('D:/selected');
  await act(async () => button('sidebar.addProject').click());
  expect(add).toHaveBeenCalledExactlyOnceWith('D:/selected');
});
