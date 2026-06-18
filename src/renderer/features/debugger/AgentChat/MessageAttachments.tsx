import React from 'react';
import type { SessionAttachmentRecord } from '@shared/types/session';
import { formatBytes } from '../../../services/attachmentHelpers';

const isImageAttachment = (attachment: SessionAttachmentRecord): boolean =>
  attachment.kind === 'image' || /^image\//i.test(attachment.mimeType ?? '');

export const MessageAttachments: React.FC<{ attachments: SessionAttachmentRecord[] }> = ({
  attachments,
}) => (
  <div className="message-attachments" data-testid="message-attachments">
    {attachments.map((attachment) => {
      const image = isImageAttachment(attachment);
      const ext = attachment.fileName.includes('.')
        ? attachment.fileName.slice(attachment.fileName.lastIndexOf('.') + 1).toUpperCase()
        : 'FILE';
      return (
        <div
          key={attachment.attachmentId}
          className={`message-attachment-pill ${image ? 'image' : ''}`.trim()}
        >
          <span className="message-attachment-pill-icon" aria-hidden="true">
            {image ? 'IMG' : ext.slice(0, 4)}
          </span>
          <span className="message-attachment-pill-copy">
            <span className="message-attachment-pill-name">{attachment.fileName}</span>
            <span className="message-attachment-pill-meta">
              {formatBytes(attachment.size)}
            </span>
          </span>
        </div>
      );
    })}
  </div>
);
