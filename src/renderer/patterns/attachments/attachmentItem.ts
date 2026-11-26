import { associatedDocumentMime, attachmentExtension, isMarkdownAttachment } from '@shared/attachmentPresentation';
import type { AttachmentLayer, AttachmentOwner, ConversationAccessAttachmentResult } from '@shared/types/conversation';
import type { MaterialContext } from '@shared/types/materialContext';

export interface AttachmentNotes {
  material: MaterialContext;
  relatedNames?: readonly string[];
  sourceHash?: string;
}

export interface AttachmentItem {
  id: string;
  owner: AttachmentOwner | null;
  fileName: string;
  mode: 'image' | 'markdown' | 'open' | 'reveal';
  error?: string;
  warning?: string;
  notes?: AttachmentNotes;
}

export type AttachmentError = Extract<ConversationAccessAttachmentResult, { kind: 'error' }>['code'];

export function attachmentMode(
  fileName: string,
  layer: AttachmentLayer | undefined,
  mimeType?: string,
): AttachmentItem['mode'] {
  if (layer === 'image' || (!layer && /^image\/(png|jpeg|gif|webp)$/i.test(mimeType ?? ''))) return 'image';
  const extension = attachmentExtension(fileName);
  if (isMarkdownAttachment(extension) && (layer === 'text' || !layer)) return 'markdown';
  return associatedDocumentMime(extension) ? 'open' : 'reveal';
}
