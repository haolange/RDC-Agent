// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MessageAttachments } from './MessageAttachments';
import type { SessionAttachmentRecord } from '@shared/types/session';

const source = vi.hoisted(() => ({
  messages: [] as Array<{ attachments: readonly SessionAttachmentRecord[] }>,
  getAttachmentPreview: vi.fn(),
  accessAttachment: vi.fn(),
}));

vi.mock('../../stores/conversationStore', () => ({ useConversationStore: (
  select: (store: { conversationMessages: typeof source.messages }) => unknown,
) => select({ conversationMessages: source.messages }) }));
vi.mock('../../platform/getElectronApi', () => ({ getElectronApi: () => ({ conversation: source }) }));
vi.mock('../../i18n', () => ({ useI18n: () => ({
  language: 'en', t: (key: string, values?: { fileName?: string }) => values?.fileName ? `${key} ${values.fileName}` : key,
}) }));

it('shows saved notes and related names from the active session without opening or fetching the other originals', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const attachment: SessionAttachmentRecord = {
    attachmentId: 'att_original', sessionId: 'session', projectId: 'project', filePath: 'original.png',
    kind: 'image', fileName: 'original.png', mimeType: 'image/png', size: 50, createdAt: 0,
    sourceHash: '0123456789abcdef', material: {
      intent: 'Compare the region in this user-provided image.',
      comparison: { group: 'Pair', role: 'baseline', conditions: 'Same setup.' },
    },
  };
  source.messages = [
    { attachments: [{ ...attachment, attachmentId: 'att_related', fileName: 'related.png' }] },
    { attachments: [{ ...attachment, attachmentId: 'att_other', fileName: 'other.png', sessionId: 'other-session' }] },
  ];
  source.getAttachmentPreview.mockResolvedValue({ dataUrl: 'data:image/png;base64,thumbnail' });
  try {
    await act(async () => root.render(createElement(MessageAttachments, { attachments: [attachment] })));
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="attachment.notes original.png"]')!;
    await act(async () => { trigger.focus(); trigger.click(); });
    const sheet = document.body.querySelector('[data-testid="attachment-notes-sheet"]');
    expect(sheet?.textContent).toContain(attachment.material?.intent);
    expect(sheet?.textContent).toContain('Same setup.');
    expect(sheet?.textContent).toContain('related.png');
    expect(sheet?.textContent).not.toContain('other.png');
    expect(sheet?.textContent).not.toContain(attachment.sourceHash);
    expect(sheet?.querySelector('[aria-label="app.copyDiagnostics"]')).not.toBeNull();
    expect(source.getAttachmentPreview).toHaveBeenCalledExactlyOnceWith({ previewId: attachment.attachmentId, sessionId: 'session' });
    expect(source.accessAttachment).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
