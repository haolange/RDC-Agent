import type { AttachmentRejectCode } from '@shared/types/conversation';
import type { TranslationKey } from '../../i18n';

/** Keep in lockstep with `MAX_ATTACHMENT_COUNT` and `ConversationStageAttachmentsArgsSchema`. */
export const COMPOSER_MAX_ATTACHMENT_COUNT = 32;

const REJECT_KEYS: Record<AttachmentRejectCode, TranslationKey> = {
  ATTACHMENT_CAPTURE_USE_PROJECT_IMPORT: 'app.attachReject.ATTACHMENT_CAPTURE_USE_PROJECT_IMPORT',
  ATTACHMENT_EXECUTABLE_DENIED: 'app.attachReject.ATTACHMENT_EXECUTABLE_DENIED',
  ATTACHMENT_LIMIT_EXCEEDED: 'app.attachReject.ATTACHMENT_LIMIT_EXCEEDED',
  ATTACHMENT_INVALID: 'app.attachReject.ATTACHMENT_INVALID',
  ATTACHMENT_MEDIA_UNSUPPORTED: 'app.attachReject.ATTACHMENT_MEDIA_UNSUPPORTED',
  ATTACHMENT_NOT_FOUND: 'app.attachReject.ATTACHMENT_NOT_FOUND',
};

export function attachmentRejectKey(code: AttachmentRejectCode): TranslationKey {
  return REJECT_KEYS[code];
}

export function isAttachmentStageOverflow(message: string): boolean {
  return /PAYLOAD_TOO_LARGE|ATTACHMENT_LIMIT_EXCEEDED|expected array to have <=32 items/i.test(message);
}
