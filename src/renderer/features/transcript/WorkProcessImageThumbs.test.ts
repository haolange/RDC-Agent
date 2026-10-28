// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { WorkProcessImageThumbs } from './WorkProcessImageThumbs';
const state = vi.hoisted(() => ({ session: 'one', retry: vi.fn(), failed: false }));
vi.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('../../stores/projectStore', () => ({ useProjectStore: (pick: (s: unknown) => unknown) => pick({ currentSession: { sessionId: state.session } }) }));
vi.mock('../../hooks/useToolImagePreviews', () => ({ useToolImagePreviews: () => ({
  values: { image: state.failed ? { failed: true } : { url: 'data:image/png;base64,AA==' } }, retry: state.retry,
}) }));
it('opens a single-line image dialog, closes with Escape, returns focus and isolates sessions', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const previews = [{ previewId: 'image', fileName: 'long-scene-input.png', mimeType: 'image/png' }];
  const render = () => act(async () => root.render(createElement(WorkProcessImageThumbs, { previews })));
  try {
    await render(); const trigger = host.querySelector<HTMLButtonElement>('button')!; trigger.focus();
    await act(async () => trigger.click());
    const dialog = document.querySelector('.tool-image-preview-dialog')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.querySelector('h2')?.textContent).toBe(previews[0].fileName);
    expect(dialog.querySelector('h2')?.getAttribute('title')).toBe(previews[0].fileName);
    expect(dialog.querySelector('.task-dialog-description')).toBeNull();
    expect(dialog.querySelector('img')?.getAttribute('title')).toBe(previews[0].fileName);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => trigger.click()); state.session = 'two'; await render();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    state.failed = true; await render(); await act(async () => host.querySelector<HTMLButtonElement>('button')!.click());
    expect(state.retry).toHaveBeenCalledWith('image');
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); state.session = 'one'; state.failed = false; }
});
