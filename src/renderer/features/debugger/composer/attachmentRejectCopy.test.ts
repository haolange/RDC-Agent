import { describe, expect, it } from 'vitest';
import {
  attachmentRejectKey,
  COMPOSER_MAX_ATTACHMENT_COUNT,
  isAttachmentStageOverflow,
} from './attachmentRejectCopy';

describe('attachmentRejectCopy', () => {
  it('maps reject codes to i18n keys', () => {
    expect(attachmentRejectKey('ATTACHMENT_LIMIT_EXCEEDED'))
      .toBe('app.attachReject.ATTACHMENT_LIMIT_EXCEEDED');
  });

  it('treats count and payload overflows as limit exceeded', () => {
    expect(COMPOSER_MAX_ATTACHMENT_COUNT).toBe(32);
    expect(isAttachmentStageOverflow(
      'ATTACHMENT_LIMIT_EXCEEDED: at most 32 attachments are allowed.',
    )).toBe(true);
    expect(isAttachmentStageOverflow('PAYLOAD_TOO_LARGE')).toBe(true);
    expect(isAttachmentStageOverflow(
      'conversation:stageAttachments schema violation: 0.items: Too big: expected array to have <=32 items',
    )).toBe(true);
    expect(isAttachmentStageOverflow('ATTACHMENT_INVALID: not valid base64')).toBe(false);
  });
});
