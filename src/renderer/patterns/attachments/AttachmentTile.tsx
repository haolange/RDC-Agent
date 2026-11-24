import { useEffect, useId, useState } from 'react';
import { getAttachmentPreview } from '../../hooks/conversationPreview';
import { useI18n } from '../../i18n';
import { Button } from '../../ui/Button';
import { Icon } from '../../ui/Icon';
import { OverflowFade } from '../../ui/OverflowFade';
import { useAttachmentAction } from './useAttachmentAction';
import type { AttachmentItem } from './attachmentItem';

type Thumbnail = { url: string } | { error: true } | null;

function useAttachmentThumbnail(item: AttachmentItem): [Thumbnail, () => void] {
  const [thumbnail, setThumbnail] = useState<Thumbnail>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const sessionId = item.owner?.scope === 'session' ? item.owner.sessionId : undefined;
  const composerScopeKey = item.owner?.scope === 'staging' ? item.owner.composerScopeKey : undefined;
  const previewId = item.owner?.scope === 'staging' ? item.owner.stagingId : item.owner?.attachmentId;
  useEffect(() => {
    if (item.mode !== 'image' || !previewId) return undefined;
    let current = true;
    const settle = (url?: string | null) => {
      if (current) setThumbnail(url ? { url } : { error: true });
    };
    const request = getAttachmentPreview({ previewId, sessionId, composerScopeKey });
    if (request) void request.then((result) => settle(result.dataUrl), () => settle());
    else settle();
    return () => { current = false; };
  }, [previewId, sessionId, composerScopeKey, item.mode]);
  const url = thumbnail && 'url' in thumbnail ? thumbnail.url : null;
  return [url && url === failedUrl ? { error: true } : thumbnail, () => setFailedUrl(url)];
}

export function AttachmentTile({ item, removeLabel, onRemove, onPreview, onNotes }: {
  item: AttachmentItem;
  removeLabel?: string;
  onRemove?: () => void;
  onPreview: () => void;
  onNotes: () => void;
}) {
  const { t } = useI18n();
  const statusId = useId();
  const image = item.mode === 'image';
  const [thumbnail, failThumbnail] = useAttachmentThumbnail(item);
  const action = useAttachmentAction(item.owner);
  const name = { fileName: item.fileName };
  const primaryLabel = t(item.mode === 'reveal' ? 'attachment.reveal' : 'attachment.open', name);
  const revealLabel = t('attachment.reveal', name);
  const notesLabel = t('attachment.notes', name);
  const status = item.error ?? (action.error && t(`attachment.error.${action.error}`))
    ?? (thumbnail && 'error' in thumbnail ? t('attachment.thumbnailUnavailable') : item.warning);
  const preview = item.mode === 'image' || item.mode === 'markdown';
  const contents = image ? (
    thumbnail && 'url' in thumbnail
      ? <img className="attachment-tile-thumbnail" src={thumbnail.url} alt="" onError={failThumbnail} />
      : <Icon name="image" size={20} />
  ) : (
    <>
      <Icon name={item.mode === 'reveal' ? 'file' : 'file-text'} size={18} />
      <span className="attachment-tile-name"><OverflowFade text={item.fileName} /></span>
    </>
  );
  return (
    <div className={`attachment-tile${image ? ' is-image' : ''}${item.error || action.error ? ' is-error' : ''}${item.warning ? ' is-warning' : ''}`}
      data-testid={onRemove ? 'composer-attachment-card' : 'message-attachment-card'}>
      <div className="attachment-tile-line">
        {item.owner ? <Button variant="reset" className="attachment-tile-target" aria-label={primaryLabel}
          data-testid={item.mode === 'reveal' ? 'attachment-reveal' : 'attachment-open'}
          data-tooltip={image ? primaryLabel : item.fileName} aria-describedby={status ? statusId : undefined}
          aria-busy={action.pending} disabled={action.pending}
          onClick={() => preview ? onPreview() : void action.run(item.mode === 'open' ? 'open' : 'reveal')}>
          {contents}
        </Button> : <span className="attachment-tile-target" aria-label={item.fileName}>{contents}</span>}
        {!image && item.mode === 'open' && item.owner ? <Button variant="ghost" size="sm"
          className="attachment-tile-action" data-testid="attachment-reveal" aria-label={revealLabel} data-tooltip={revealLabel}
          disabled={action.pending} onClick={() => void action.run('reveal')}><Icon name="folder" size={16} /></Button> : null}
        {item.notes ? <Button variant="ghost" size="sm" aria-label={notesLabel} data-tooltip={notesLabel}
          className="attachment-tile-action attachment-tile-notes" onClick={onNotes}><Icon name="info" size={14} /></Button> : null}
        {onRemove && removeLabel ? <Button variant="ghost" size="sm" aria-label={removeLabel} data-tooltip={removeLabel}
          className="attachment-tile-action attachment-tile-remove" data-testid="attachment-remove" onClick={onRemove}>
          <Icon name="close" size={14} />
        </Button> : null}
      </div>
      {status ? <p className="attachment-tile-status" id={statusId} role="status">{status}</p> : null}
    </div>
  );
}
