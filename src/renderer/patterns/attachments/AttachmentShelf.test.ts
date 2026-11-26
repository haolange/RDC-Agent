// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttachmentShelf } from './AttachmentShelf';
import type { AttachmentItem } from './attachmentItem';

const api = vi.hoisted(() => ({ getAttachmentPreview: vi.fn(), accessAttachment: vi.fn() }));
vi.mock('../../platform/getElectronApi', () => ({ getElectronApi: () => ({ conversation: api }) }));
vi.mock('../../i18n', () => ({
  useI18n: () => ({
    language: 'en',
    t: (key: string, values?: { fileName?: string }) => (values?.fileName ? `${key} ${values.fileName}` : key),
  }),
}));

const staged = {
  scope: 'staging',
  stagingId: '11111111111111111111111111111111',
  composerScopeKey: 'project:session',
} as const;
const attached = { scope: 'session', attachmentId: 'att_second', sessionId: 'session' } as const;
const thumbnail = 'data:image/png;base64,thumbnail';
const original = 'data:image/png;base64,original';

describe('attachments', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.resetAllMocks();
    api.getAttachmentPreview.mockResolvedValue({ dataUrl: thumbnail });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const render = (items: AttachmentItem[], onRemove?: (id: string) => void) =>
    act(async () =>
      root.render(createElement(AttachmentShelf, { items, onRemove, className: 'attachments', testId: 'attachments' })),
    );
  const openTarget = (index = 0) => host.querySelectorAll<HTMLButtonElement>('[data-testid="attachment-open"]')[index];
  const dialog = () => document.body.querySelector<HTMLDivElement>('[role="dialog"]');
  const click = (target: HTMLElement) =>
    act(async () => {
      target.focus();
      target.click();
    });

  it('requests originals lazily in the shelf gallery and restores the triggering thumbnail on Escape', async () => {
    api.accessAttachment.mockResolvedValue({ kind: 'image', dataUrl: original });
    await render([
      { id: 'first', owner: staged, mode: 'image', fileName: 'first.png' },
      { id: 'second', owner: attached, mode: 'image', fileName: 'second.png' },
    ]);
    expect(api.accessAttachment).not.toHaveBeenCalled();
    expect(openTarget().querySelector('img')?.getAttribute('src')).toBe(thumbnail);
    expect(openTarget().textContent).toBe('');
    expect(openTarget().getAttribute('aria-label')).toBe('attachment.open first.png');
    expect(api.getAttachmentPreview.mock.calls.map(([request]) => request)).toEqual([
      { previewId: staged.stagingId, composerScopeKey: staged.composerScopeKey },
      { previewId: attached.attachmentId, sessionId: attached.sessionId },
    ]);

    await click(openTarget());
    expect(api.accessAttachment).toHaveBeenCalledExactlyOnceWith({ owner: staged, action: 'preview' });
    expect(dialog()?.querySelector('.ui-image-viewer-image')?.getAttribute('src')).toBe(original);
    expect(dialog()?.getAttribute('aria-label')).toBe('first.png');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
    expect(api.accessAttachment).toHaveBeenLastCalledWith({ owner: attached, action: 'preview' });
    expect(dialog()?.getAttribute('aria-label')).toBe('second.png');
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
    expect(document.activeElement).toBe(openTarget());
    expect(dialog()).toBeNull();
  });

  it('reads Markdown with HTTPS links and keeps relative links and embedded media local to the preview', async () => {
    api.accessAttachment.mockResolvedValue({
      kind: 'markdown',
      source:
        '# Heading\n\n[外部](https://example.com)\n\n[同目录](notes.md)\n\n![Picture](https://example.com/picture.png)\n\nLast paragraph.',
    });
    await render([{ id: 'markdown', owner: staged, fileName: 'file.markdown', mode: 'markdown' }]);
    await click(openTarget());
    const reader = document.body.querySelector('[data-testid="attachment-reading-sheet"]');
    expect(reader?.querySelector('h1')?.textContent).toBe('Heading');
    expect(reader?.textContent).toContain('Last paragraph.');
    expect(reader?.textContent).toContain('Picture');
    expect(reader?.querySelector('img, video, textarea')).toBeNull();
    expect([...(reader?.querySelectorAll('a[href]') ?? [])].map((link) => link.getAttribute('href'))).toEqual([
      'https://example.com',
    ]);
    expect(reader?.querySelector('[data-tooltip="notes.md"]')?.textContent).toBe('同目录');
    expect(api.accessAttachment).toHaveBeenCalledExactlyOnceWith({ owner: staged, action: 'preview' });
  });

  it('keeps a native open error with its file and preserves explicit reveal and remove', async () => {
    api.accessAttachment
      .mockResolvedValueOnce({ kind: 'error', code: 'openFailed' })
      .mockResolvedValueOnce({ kind: 'revealed' });
    const remove = vi.fn();
    await render(
      [
        { id: 'pdf', owner: staged, fileName: 'report.pdf', mode: 'open' },
        { id: 'ordinary', owner: attached, fileName: 'read.py', mode: 'reveal' },
      ],
      remove,
    );
    await click(openTarget());
    const [pdf, ordinary] = host.querySelectorAll('[data-testid="composer-attachment-card"]');
    expect(pdf.textContent).toContain('attachment.error.openFailed');
    expect(ordinary.textContent).not.toContain('attachment.error.openFailed');
    await click(pdf.querySelector<HTMLButtonElement>('[data-testid="attachment-reveal"]')!);
    expect(api.accessAttachment).toHaveBeenLastCalledWith({ owner: staged, action: 'reveal' });
    await click(ordinary.querySelector<HTMLButtonElement>('[data-testid="attachment-remove"]')!);
    expect(remove).toHaveBeenCalledExactlyOnceWith('ordinary');
  });
});
