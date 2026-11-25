import { useEffect, useState } from 'react';
import { accessAttachment } from '../../hooks/conversationPreview';
import { useI18n } from '../../i18n';
import { ImageViewer } from '../../ui/ImageViewer';
import { ReadingSheet } from '../../ui/ReadingSheet';
import { IconButton } from '../../ui/IconButton';
import { Icon } from '../../ui/Icon';
import { MessageMarkdown } from '../Markdown/MessageMarkdown';
import { AttachmentNotesBody } from './AttachmentNotesBody';
import { useAttachmentAction } from './useAttachmentAction';
import type { ConversationAccessAttachmentResult } from '@shared/types/conversation';
import type { AttachmentItem } from './attachmentItem';

export type AttachmentView = { item: AttachmentItem; mode: 'image' | 'markdown' | 'notes'; open: boolean };

type PreviewResult = { item: AttachmentItem; result: ConversationAccessAttachmentResult };

export function AttachmentPreviewDialog({ view, items, onSelectImage, onClose, onExited }: {
  view: AttachmentView;
  items: readonly AttachmentItem[];
  onSelectImage: (item: AttachmentItem) => void;
  onClose: () => void;
  onExited: () => void;
}) {
  const { t } = useI18n();
  const { item, mode, open } = view;
  const [loaded, setLoaded] = useState<PreviewResult | null>(null);
  const action = useAttachmentAction(item.owner);
  useEffect(() => {
    if (!open || mode === 'notes' || !item.owner) return undefined;
    let current = true;
    void accessAttachment({ owner: item.owner, action: 'preview' }).then((result) => {
      if (current) setLoaded({ item, result });
    });
    return () => { current = false; };
  }, [item, mode, open]);

  const result = loaded?.item === item ? loaded.result : null;
  const previewError = result && result.kind !== mode
    ? result.kind === 'error' ? result.code : 'unsupported'
    : null;
  const status = <>
    {mode !== 'notes' && !result ? <div role="status">{t('attachment.loading')}</div> : null}
    {previewError ? <div role="status">{t(`attachment.error.${previewError}`)}</div> : null}
    {action.error ? <div role="status">{t(`attachment.error.${action.error}`)}</div> : null}
  </>;
  const hasStatus = (mode !== 'notes' && !result) || previewError || action.error;
  const revealLabel = t('attachment.reveal', { fileName: item.fileName });
  const actions = item.owner ? <IconButton size="sm" label={revealLabel} data-tooltip={revealLabel}
    data-testid="attachment-reveal" aria-busy={action.pending} disabled={action.pending}
    onClick={() => void action.run('reveal')}><Icon name="folder" size={16} /></IconButton> : null;

  if (mode === 'image') {
    const images = items.filter((candidate) => candidate.mode === 'image' && candidate.owner);
    const index = images.findIndex((candidate) => candidate.id === item.id);
    return <ImageViewer open={open && index >= 0} index={Math.max(0, index)}
      items={images.map((candidate) => ({
        title: candidate.fileName,
        src: candidate.id === item.id && result?.kind === 'image' ? result.dataUrl : undefined,
      }))}
      actions={actions} status={hasStatus ? status : undefined}
      onImageError={() => setLoaded({ item, result: { kind: 'error', code: 'unsupported' } })}
      onIndexChange={(next) => onSelectImage(images[next])} onClose={onClose} onExited={onExited} />;
  }

  return <ReadingSheet open={open} title={item.fileName} closeLabel={t('dialog.close')}
    dataTestId={mode === 'markdown' ? 'attachment-reading-sheet' : 'attachment-notes-sheet'}
    actions={actions} status={hasStatus ? status : undefined} onClose={onClose} onExited={onExited}>
    {mode === 'markdown' && result?.kind === 'markdown' ? <MessageMarkdown content={result.source} preserveSource
      interactive={false} renderImage={({ alt }) => alt ? <span>{alt}</span> : null}
      renderLink={({ href, children }) => href && /^https:\/\//iu.test(href)
        ? <a href={href} target="_blank" rel="noreferrer noopener" data-tooltip={href}>{children}</a>
        : <span tabIndex={href ? 0 : undefined} data-tooltip={href}>{children}</span>} /> : null}
    {mode === 'notes' && item.notes ? <AttachmentNotesBody notes={item.notes} /> : null}
  </ReadingSheet>;
}
