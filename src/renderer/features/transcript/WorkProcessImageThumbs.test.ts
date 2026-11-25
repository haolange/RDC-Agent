// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { WorkProcessImageThumbs } from './WorkProcessImageThumbs';
const state = vi.hoisted(() => ({ session: 'one', retry: vi.fn(), failed: false }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../lib/useUiLabels', () => ({ useUiLabels: () => ({ imageViewer: {
  close: 'close', previous: 'previous', next: 'next', zoomIn: 'zoomIn', zoomOut: 'zoomOut', reset: 'reset', openOriginal: 'open',
  position: (current: number, total: number) => `${current}/${total}`,
} }) }));
vi.mock('../../stores/projectStore', () => ({ useProjectStore: (pick: (s: unknown) => unknown) => pick({ currentSessionId: state.session }) }));
vi.mock('../../hooks/useToolImagePreviews', () => ({ useToolImagePreviews: () => ({
  values: {
    image: state.failed ? { failed: true } : { url: 'data:image/png;base64,AA==' },
    comparison: { url: 'data:image/png;base64,AA==' },
  }, retry: state.retry,
}) }));
it('opens the image viewer with a readable caption, closes with Escape, returns focus and isolates sessions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const previews = [{ previewId: 'image', fileName: 'long-scene-input.png', mimeType: 'image/png' }];
  const render = () => act(async () => root.render(createElement(WorkProcessImageThumbs, { previews })));
  try {
    await render(); const trigger = host.querySelector<HTMLButtonElement>('button')!; trigger.focus();
    await act(async () => trigger.click());
    const dialog = document.querySelector('.ui-image-viewer [role="dialog"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.querySelector('.ui-image-viewer-title')?.textContent).toBe('long scene input');
    expect(dialog.querySelector('img')?.getAttribute('alt')).toBe('long scene input');
    // A single image has no previous / next controls and no position counter.
    expect(dialog.querySelector('.ui-image-viewer-step')).toBeNull();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click()); state.session = 'two'; await render();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    state.failed = true; await render(); await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(state.retry).toHaveBeenCalledWith('image');
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); state.session = 'one'; state.failed = false; }
});

it('returns to the opening thumbnail when Escape follows image navigation and zoom', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  state.session = 'gallery'; state.failed = false;
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const previews = [
    { previewId: 'image', fileName: 'first-frame.png', mimeType: 'image/png' },
    { previewId: 'comparison', fileName: 'second-frame.png', mimeType: 'image/png' },
  ];
  const key = (value: string) => act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true })));
  try {
    await act(async () => root.render(createElement(WorkProcessImageThumbs, { previews })));
    const trigger = host.querySelector<HTMLButtonElement>('button')!;
    trigger.focus();
    await act(async () => trigger.click());
    await key('ArrowRight');
    expect(document.querySelector('.ui-image-viewer-position')?.textContent).toBe('2/2');
    await key('+');
    expect(document.querySelector('.ui-image-viewer-image.is-zoomed')).not.toBeNull();
    await key('Escape');
    expect(document.querySelector('.ui-image-viewer')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
