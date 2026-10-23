// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ProjectCaptureReferenceDialog } from './ProjectCaptureReferenceDialog';

const reference = vi.hoisted(() => vi.fn());
vi.mock('./projectCaptureActions', () => ({ referenceProjectInput: reference }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); reference.mockReset();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const button = () => [...document.querySelectorAll('button')].find(b => b.textContent === 'projectCapture.registerReference')!;
function fill(value: string) {
  const input = document.querySelector('input')!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
it('preserves the trigger for modal focus restoration', () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus();
  act(() => root.render(createElement(ProjectCaptureReferenceDialog, { projectId: 'project', onClose: vi.fn(), onRegistered: vi.fn() })));
  expect(document.activeElement).toBe(trigger);
  act(() => root.unmount()); root = createRoot(host);
  expect(document.activeElement).toBe(trigger); trigger.remove();
});
it('disables empty and pending submission, rejects duplicate Enter, and retains failed drafts for retry', async () => {
  let finish!: (result: { success: boolean; error: string }) => void;
  reference.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const close = vi.fn(), registered = vi.fn();
  act(() => root.render(createElement(ProjectCaptureReferenceDialog, { projectId: 'project', onClose: close, onRegistered: registered })));
  expect(button().disabled).toBe(true);
  act(() => fill('D:/original/capture.rdc'));
  act(() => button().click());
  expect(button().disabled).toBe(true); expect(document.querySelector('input')!.disabled).toBe(true);
  act(() => document.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(reference).toHaveBeenCalledExactlyOnceWith('project', 'D:/original/capture.rdc');
  await act(async () => finish({ success: false, error: 'SOURCE_CHANGED' }));
  expect(document.querySelector('[role="alert"]')?.textContent).toBe('SOURCE_CHANGED');
  expect(document.querySelector('input')!.value).toBe('D:/original/capture.rdc');
  expect(button().disabled).toBe(false); expect(close).not.toHaveBeenCalled(); expect(registered).not.toHaveBeenCalled();
  reference.mockResolvedValue({ success: true, inputs: [] });
  await act(async () => button().click());
  expect(registered).toHaveBeenCalledWith('project', []); expect(close).toHaveBeenCalledOnce();
});
