import { describe, expect, it } from 'vitest';
import { attachmentRejectKey } from './attachmentRejectCopy';

describe('attachmentRejectCopy', () => {
  it('maps reject codes to i18n keys', () => {
    expect(attachmentRejectKey('ATTACHMENT_LIMIT_EXCEEDED')).toBe('app.attachReject.ATTACHMENT_LIMIT_EXCEEDED');
  });
});
