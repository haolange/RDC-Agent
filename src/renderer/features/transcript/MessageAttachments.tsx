import React, { useEffect, useState } from 'react';
import type { SessionAttachmentRecord } from '@shared/types/session';
import { formatBytes } from '../../services/attachmentHelpers';
import { openAppPath } from '../../hooks/appShellBridge';
import { getAttachmentPreview } from '../../hooks/conversationPreview';

const isImageAttachment = (attachment: SessionAttachmentRecord): boolean =>
  attachment.kind === 'image' || /^image\/(png|jpeg|gif|webp)$/i.test(attachment.mimeType ?? '');

const MessageAttachmentPill: React.FC<{
  attachment: SessionAttachmentRecord;
  sessionId: string | null;
}> = ({ attachment, sessionId }) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const image = isImageAttachment(attachment);
  const ext = attachment.fileName.includes('.')
    ? attachment.fileName.slice(attachment.fileName.lastIndexOf('.') + 1).toUpperCase()
    : 'FILE';

  useEffect(() => {
    if (!image || !sessionId) return undefined;
    let cancelled = false;
    void getAttachmentPreview({
      previewId: attachment.attachmentId,
      sessionId,
    })?.then((result) => {
      if (!cancelled && result?.dataUrl) setPreviewUrl(result.dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.attachmentId, image, sessionId]);

  const openAttachment = () => {
    if (!attachment.filePath) return;
    void openAppPath(attachment.filePath);
  };

  return (
    <button
      type="button"
      className={`message-attachment-pill ${image ? 'image' : ''}`.trim()}
      onClick={openAttachment}
    >
      <span className="message-attachment-pill-icon" aria-hidden="true">
        {previewUrl ? (
          <img src={previewUrl} alt="" className="message-attachment-pill-thumb" />
        ) : image ? 'IMG' : ext.slice(0, 4)}
      </span>
      <span className="message-attachment-pill-copy">
        <span className="message-attachment-pill-name">{attachment.fileName}</span>
        <span className="message-attachment-pill-meta">{formatBytes(attachment.size)}</span>
      </span>
    </button>
  );
};

export const MessageAttachments: React.FC<{ attachments: SessionAttachmentRecord[] }> = ({
  attachments,
}) => (
  <div className="message-attachments" data-testid="message-attachments">
    {attachments.map((attachment) => (
      <MessageAttachmentPill
        key={attachment.attachmentId}
        attachment={attachment}
        sessionId={attachment.sessionId || null}
      />
    ))}
  </div>
);
