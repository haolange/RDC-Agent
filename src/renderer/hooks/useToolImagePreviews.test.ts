// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useToolImagePreviews } from './useToolImagePreviews';
const mock = vi.hoisted(() => ({ read: vi.fn(), scope: 'a', result: undefined as ReturnType<typeof useToolImagePreviews> | undefined }));
vi.mock('./conversationPreview', () => ({ getToolImagePreview: mock.read }));
let root: Root; let host: HTMLDivElement;
const refs = (count: number) => Array.from({ length: count }, (_, i) => ({ previewId: String(i), fileName: `${i}.png`, mimeType: 'image/png' }));
function Probe({ count }: { count: number }) { mock.result = useToolImagePreviews(mock.scope, refs(count)); return null; }
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mock.read.mockReset(); mock.scope = 'a'; host = document.createElement('div'); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
it('limits concurrent reads to four and publishes each independently', async () => {
  const done: Array<(value: { dataUrl: string }) => void> = [];
  mock.read.mockImplementation(() => new Promise(resolve => done.push(resolve)));
  await act(async () => root.render(createElement(Probe, { count: 6 })));
  expect(mock.read).toHaveBeenCalledTimes(4);
  await act(async () => done[1]({ dataUrl: 'second' }));
  expect(mock.result?.values['1'].url).toBe('second');
  expect(mock.result?.values['0']).toBeUndefined();
  expect(mock.read).toHaveBeenCalledTimes(5);
  await act(async () => { for (const resolve of done) resolve({ dataUrl: 'ok' }); });
  await act(async () => done.at(-1)!({ dataUrl: 'last' }));
});
it('isolates late responses after a session change', async () => {
  let first!: (value: { dataUrl: string }) => void;
  mock.read.mockImplementationOnce(() => new Promise(resolve => { first = resolve; })).mockResolvedValue({ dataUrl: 'new' });
  await act(async () => root.render(createElement(Probe, { count: 1 })));
  mock.scope = 'b';
  await act(async () => root.render(createElement(Probe, { count: 1 })));
  await act(async () => first({ dataUrl: 'old' }));
  expect(mock.result?.values['0'].url).toBe('new');
});
it('retries only the failed preview and preserves successful siblings', async () => {
  mock.read.mockImplementation(({ previewId }) => previewId === '0' ? Promise.reject(new Error('missing')) : Promise.resolve({ dataUrl: 'ok' }));
  await act(async () => root.render(createElement(Probe, { count: 2 })));
  expect(mock.result?.values['0'].failed).toBe(true);
  mock.read.mockResolvedValue({ dataUrl: 'retry' });
  await act(async () => mock.result?.retry('0'));
  expect(mock.read).toHaveBeenCalledTimes(3);
  expect(mock.result?.values['1'].url).toBe('ok');
  expect(mock.result?.values['0'].url).toBe('retry');
});
