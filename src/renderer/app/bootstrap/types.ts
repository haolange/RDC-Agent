import type { ConversationAttachmentInput } from '@shared/types/conversation';
import type { SessionAttachmentRecord } from '@shared/types/session';

export interface PendingAttachmentDraft extends ConversationAttachmentInput {
  id: string;
  kind: SessionAttachmentRecord['kind'];
  isCapture: boolean;
}
