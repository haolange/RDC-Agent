// @vitest-environment happy-dom
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkProcessImageRow } from './WorkProcessImageRow';
import type { ToolRowModel } from './workProcessToolTypes';
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string, args?: { count?: number }) => `${key}:${args?.count ?? ''}` }) }));
vi.mock('../../stores/projectStore', () => ({ useProjectStore: (select: (state: unknown) => unknown) => select({ currentSession: { sessionId: 'scope' } }) }));
vi.mock('./ScopedWorkDisclosure', () => ({ useScopedWorkDisclosure: () => { const [open, set] = useState(false); return [open, () => set(value => !value)]; } }));
vi.mock('./WorkProcessImageThumbs', () => ({ WorkProcessImageThumbs: ({ previews }: { previews: Array<{ previewId: string }> }) => createElement('div', { 'data-gallery': true }, previews.map(p => createElement('img', { key: p.previewId, 'data-preview': p.previewId }))) }));
vi.mock('./WorkProcessToolCardParts', () => ({ RawPanel: ({ row }: { row: ToolRowModel }) => createElement('pre', null, row.id) }));
vi.mock('./WorkProcessFamilyLayers', () => ({ CopyPathButton: () => null }));
let host: HTMLDivElement; let root: Root;
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const row = (count: number, retained = true): ToolRowModel => {
  const calls = Array.from({ length: count }, (_, i) => ({ id: String(i), toolName: 'read_image', type: 'tool', status: 'complete', target: `image-${i}.png`, duration: '1ms',
    imagePreviews: retained ? [{ previewId: String(i), fileName: `${i}.png`, mimeType: 'image/png' }] : [], argsLines: [], rawLines: [] } as unknown as ToolRowModel));
  return { ...calls[0], imageCalls: calls };
};
it.each([1, 4, 5, 25])('bounds the default gallery for %i successful reads and preserves receipts on expansion', async count => {
  await act(async () => root.render(createElement(WorkProcessImageRow, { row: row(count) })));
  expect(host.querySelectorAll('img')).toHaveLength(Math.min(count, 4));
  expect(host.textContent).toContain(`chat.imagesViewed:${count}`);
  expect(host.querySelectorAll('[data-image-call-id]')).toHaveLength(0);
  const more = host.querySelector<HTMLButtonElement>('button[aria-label^="chat.imagesShowMore"]');
  expect(Boolean(more)).toBe(count > 4);
  await act(async () => (more ?? host.querySelector('button')!).click());
  expect(host.querySelectorAll('[data-image-call-id]')).toHaveLength(Math.min(count, 20));
  if (count > 20) {
    const load = Array.from(host.querySelectorAll('button')).find(button => button.textContent?.includes('imagesLoadMore'))!;
    await act(async () => load.click());
    expect(host.querySelectorAll('[data-image-call-id]')).toHaveLength(count);
  }
});
it('retains a truthful count when historical preview references are missing', async () => {
  await act(async () => root.render(createElement(WorkProcessImageRow, { row: row(2, false) })));
  expect(host.textContent).toContain('chat.imagesViewed:2');
  expect(host.textContent).toContain('chat.imageMissingReference');
  expect(host.querySelectorAll('img')).toHaveLength(0);
});
