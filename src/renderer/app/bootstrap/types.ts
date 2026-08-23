import type {
  AttachmentLayer,
  ComposerAttachmentError,
  ConversationAttachmentInput,
} from '@shared/types/conversation';
import type { SessionAttachmentRecord } from '@shared/types/session';

export interface PendingAttachmentDraft extends ConversationAttachmentInput {
  id: string;
  stagingId: string;
  kind: SessionAttachmentRecord['kind'];
  layer: AttachmentLayer;
  previewId?: string;
  error?: ComposerAttachmentError;
}
