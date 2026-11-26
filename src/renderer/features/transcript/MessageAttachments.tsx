import { useMemo } from 'react';
import { AttachmentShelf } from '../../patterns/attachments/AttachmentShelf';
import { attachmentMode, type AttachmentItem, type AttachmentNotes } from '../../patterns/attachments/attachmentItem';
import { useConversationStore } from '../../stores/conversationStore';
import type { ConversationMessage } from '@shared/types/conversation';
import type { SessionAttachmentRecord } from '@shared/types/session';

const NO_RELATED_MESSAGES: readonly ConversationMessage[] = [];

function notesFor(
  attachment: SessionAttachmentRecord,
  messages: readonly ConversationMessage[],
): AttachmentNotes | undefined {
  const { material, sourceHash, sessionId } = attachment;
  if (!material || !Object.values(material).some(Boolean)) return undefined;
  const group = material.comparison?.group;
  const related = new Map<string, string>();
  if (group) {
    for (const message of messages) {
      for (const candidate of message.attachments ?? []) {
        if (
          candidate.sessionId === sessionId &&
          candidate.attachmentId !== attachment.attachmentId &&
          candidate.material?.comparison?.group === group
        ) {
          related.set(candidate.attachmentId, candidate.fileName);
        }
      }
    }
  }
  return { material, sourceHash, relatedNames: [...related.values()] };
}

export function MessageAttachments({ attachments }: { attachments: readonly SessionAttachmentRecord[] }) {
  const hasComparison = attachments.some((item) => item.material?.comparison);
  const messages = useConversationStore((state) => (hasComparison ? state.conversationMessages : NO_RELATED_MESSAGES));
  const items = useMemo(
    () =>
      attachments.map((attachment): AttachmentItem => ({
        id: attachment.attachmentId,
        owner:
          attachment.sessionId && !attachment.attachmentId.startsWith('optimistic-')
            ? { scope: 'session', attachmentId: attachment.attachmentId, sessionId: attachment.sessionId }
            : null,
        fileName: attachment.fileName,
        mode: attachmentMode(attachment.fileName, attachment.layer, attachment.mimeType),
        notes: notesFor(attachment, messages),
      })),
    [attachments, messages],
  );
  return (
    <AttachmentShelf
      key={attachments[0]?.sessionId}
      items={items}
      className="message-attachments"
      testId="message-attachments"
    />
  );
}
