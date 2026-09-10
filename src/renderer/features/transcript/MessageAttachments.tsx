import React, { useEffect, useMemo, useState } from 'react';
import type { SessionAttachmentRecord } from '@shared/types/session';
import { formatBytes } from '../../services/attachmentHelpers';
import { openAppPath } from '../../hooks/appShellBridge';
import { MaterialContextViewer } from '../../patterns/MaterialContextViewer';
import { useConversationStore } from '../../stores/conversationStore';
import { getAttachmentPreview } from '../../hooks/conversationPreview';

const isImageAttachment = (attachment: SessionAttachmentRecord): boolean =>
  attachment.kind === 'image' || /^image\/(png|jpeg|gif|webp)$/i.test(attachment.mimeType ?? '');

const MessageAttachmentPill: React.FC<{
  attachment: SessionAttachmentRecord;
  previewUrl?: string;
  onInspect: (attachment: SessionAttachmentRecord) => void;
}> = ({ attachment, previewUrl, onInspect }) => {
  const image = isImageAttachment(attachment);
  const ext = attachment.fileName.includes('.')
    ? attachment.fileName.slice(attachment.fileName.lastIndexOf('.') + 1).toUpperCase()
    : 'FILE';

  const openAttachment = () => {
    onInspect(attachment);
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

export const MessageAttachments: React.FC<{ attachments: SessionAttachmentRecord[] }> = ({ attachments }) => {
  const [selected, setSelected] = useState<SessionAttachmentRecord | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const messages = useConversationStore(state => state.conversationMessages);
  const available = useMemo(() => [...new Map([...messages.flatMap(message => message.attachments ?? []), ...attachments]
    .filter(item => item.sessionId === attachments[0]?.sessionId).map(item => [item.attachmentId, item])).values()], [messages, attachments]);
  const group = selected?.material?.comparison?.group;
  const items = selected ? available.filter(item => item.attachmentId === selected.attachmentId || (group && item.material?.comparison?.group === group)) : [];
  useEffect(() => {
    let cancelled = false;
    for (const attachment of (selected ? available : attachments)) {
      if (!isImageAttachment(attachment) || !attachment.sessionId) continue;
      void getAttachmentPreview({ previewId: attachment.attachmentId, sessionId: attachment.sessionId })?.then(result => {
        if (!cancelled && result?.dataUrl) setPreviews(current => ({ ...current, [attachment.attachmentId]: result.dataUrl! }));
      });
    }
    return () => { cancelled = true; };
  }, [attachments, available, selected]);
  return <div className="message-attachments" data-testid="message-attachments">
    {attachments.map(attachment => <MessageAttachmentPill key={attachment.attachmentId} attachment={attachment} previewUrl={previews[attachment.attachmentId]} onInspect={setSelected} />)}
    {selected && <MaterialContextViewer items={items.map(item => ({ id: item.attachmentId, name: item.fileName, previewUrl: previews[item.attachmentId], material: item.material, hash: item.sourceHash }))}
      onClose={() => setSelected(null)} onOpenOriginal={id => { const file = available.find(item => item.attachmentId === id)?.filePath; if (file) void openAppPath(file); }} />}
  </div>;
};
