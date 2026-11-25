// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NewAgentDialog } from './NewAgentDialog';
vi.mock('../../../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it('lets Enter commit an IME candidate without creating the Agent', () => {
  const onCreate = vi.fn();
  act(() => root.render(createElement(NewAgentDialog, {
    scopeLabel: 'User', existingIds: [], onCreate, onClose: () => undefined,
  })));
  const input = document.querySelector<HTMLInputElement>('input[aria-label="settings.agentName"]')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { setValue.call(input, '着色器'); input.dispatchEvent(new Event('input', { bubbles: true })); });
  const enter = (init: KeyboardEventInit) => act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
  });
  enter({ isComposing: true });
  expect(onCreate).not.toHaveBeenCalled();
  enter({});
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ name: '着色器' }));
});
