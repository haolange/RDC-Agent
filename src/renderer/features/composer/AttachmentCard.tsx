import { MaterialContextEditor } from '../../patterns/MaterialContextEditor';
import { Button } from '../../ui';
import type { MaterialContext } from '@shared/types/materialContext';
import React, { useEffect, useState } from 'react';
import type { PendingAttachmentDraft } from '../../types/attachments';
import { ellipsizeFileName, fileExtensionLabel, formatBytes } from '../../services/attachmentHelpers';
import { getAttachmentPreview } from '../../hooks/conversationPreview';
import { useI18n } from '../../i18n';
import { attachmentRejectKey } from './attachmentRejectCopy';

const LAYER_GLYPH: Record<PendingAttachmentDraft['layer'], string> = {
  image: 'IMG',
  text: 'TXT',
  pdf: 'PDF',
  binary: 'FILE',
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
  const { t, language } = useI18n();
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
      : `${fileExtensionLabel(attachment.fileName)} · ${formatBytes(attachment.size)}`;

  return (
    <div
      className={`composer-attachment-card layer-${attachment.layer}${failed ? ' is-error' : ''}${warning ? ' is-warning' : ''}`}
      data-testid="composer-attachment-card"
    >
      <div className="composer-attachment-card-preview" aria-hidden="true">
        {previewUrl ? (
          <img src={previewUrl} alt="" className="composer-attachment-card-thumb" />
        ) : (
          <span className="composer-attachment-card-glyph">{LAYER_GLYPH[attachment.layer]}</span>
        )}
      </div>
      <span className="composer-attachment-card-copy">
        <span className="composer-attachment-card-name" title={attachment.fileName}>
          {ellipsizeFileName(attachment.fileName)}
        </span>
        <span className="composer-attachment-card-meta">{meta}</span>
      </span>
      {!failed && <Button variant="ghost" onClick={() => setEditing(true)} aria-label={language === 'zh-CN' ? `说明 ${attachment.fileName}` : `Describe ${attachment.fileName}`}>{language === 'zh-CN' ? '说明' : 'Details'}</Button>}
      {editing && <MaterialContextEditor fileName={attachment.fileName} previewUrl={previewUrl} value={attachment.material} onSave={value => onMaterialChange(attachment.id, value)} onClose={() => setEditing(false)} />}
      <button
        type="button"
        className="composer-attachment-card-remove"
        onClick={() => onRemove(attachment.id)}
        aria-label={removeLabel}
      >
        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
          <path
            d="M3.2 3.2 12.8 12.8M12.8 3.2 3.2 12.8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
};
