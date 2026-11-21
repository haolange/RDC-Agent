import React, { useEffect, useState } from 'react';
import { OverflowFade } from '../../ui/OverflowFade';
import { Button } from '../../ui/Button';
import { MaterialContextEditor } from '../../patterns/MaterialContextEditor';
import { fileExtensionLabel, formatBytes } from '../../services/attachmentHelpers';
import { getAttachmentPreview } from '../../hooks/conversationPreview';
import { useI18n } from '../../i18n';
import { Icon, type IconName } from '../../ui/Icon';
import { attachmentRejectKey } from './attachmentRejectCopy';
import type { PendingAttachmentDraft } from '../../types/attachments';
import type { MaterialContext } from '@shared/types/materialContext';

const LAYER_ICONS: Record<PendingAttachmentDraft['layer'], IconName> = {
  image: 'image',
  text: 'file-text',
  pdf: 'file-text',
  binary: 'file',
};

export const AttachmentCard: React.FC<{
  attachment: PendingAttachmentDraft;
  composerScopeKey: string;
  visionUnsupported?: boolean;
  visionUnsupportedLabel: string;
  removeLabel: string;
  onRemove: (attachmentId: string) => void;
  onMaterialChange: (attachmentId: string, material: MaterialContext) => void;
}> = ({
  attachment,
  composerScopeKey,
  visionUnsupported = false,
  visionUnsupportedLabel,
  removeLabel,
  onRemove,
  onMaterialChange,
}) => {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const failed = Boolean(attachment.error);
  const warning = !failed && attachment.layer === 'image' && visionUnsupported;

  useEffect(() => {
    if (attachment.layer !== 'image' || !attachment.previewId || failed) return undefined;
    let cancelled = false;
    void getAttachmentPreview({
      previewId: attachment.previewId,
      composerScopeKey,
    })?.then((result) => {
      if (!cancelled && result?.dataUrl) setPreviewUrl(result.dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.layer, attachment.previewId, composerScopeKey, failed]);

  const meta = attachment.error
    ? t(attachmentRejectKey(attachment.error.code))
    : warning
      ? visionUnsupportedLabel
      : [fileExtensionLabel(attachment.fileName), formatBytes(attachment.size)].filter(Boolean).join(' · ');

  return (
    <div
      className={`composer-attachment-card layer-${attachment.layer}${failed ? ' is-error' : ''}${warning ? ' is-warning' : ''}`}
      data-testid="composer-attachment-card"
    >
      <div className="composer-attachment-card-preview" aria-hidden="true">
        {previewUrl ? (
          <img src={previewUrl} alt="" className="composer-attachment-card-thumb" />
        ) : (
          <span className="composer-attachment-card-glyph"><Icon name={LAYER_ICONS[attachment.layer]} size={20} /></span>
        )}
      </div>
      <span className="composer-attachment-card-copy">
        <span className="composer-attachment-card-name" data-tooltip={attachment.fileName}>
          <OverflowFade text={attachment.fileName} />
        </span>
        <span className="composer-attachment-card-meta">{meta}</span>
      </span>
      {!failed && <Button variant="ghost" onClick={() => setEditing(true)} aria-label={t('composer.attachment.describe', { fileName: attachment.fileName })}>{t('composer.attachment.details')}</Button>}
      {editing && <MaterialContextEditor fileName={attachment.fileName} previewUrl={previewUrl} value={attachment.material} onSave={value => onMaterialChange(attachment.id, value)} onClose={() => setEditing(false)} />}
      <Button variant="ghost" size="sm"
        type="button"
        className="composer-attachment-card-remove"
        onClick={() => onRemove(attachment.id)}
        aria-label={removeLabel}
      >
        <Icon name="close" size={12} />
      </Button>
    </div>
  );
};
