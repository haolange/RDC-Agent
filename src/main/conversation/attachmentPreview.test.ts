import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertAttachmentPreviewPath } from './attachmentPreview';

describe('assertAttachmentPreviewPath', () => {
  const root = path.resolve('/sessions/session-a/attachments');

  it('accepts files inside the session attachments directory', () => {
    const filePath = path.join(root, 'dot.png');
    expect(assertAttachmentPreviewPath(root, filePath)).toBe(path.resolve(filePath));
  });

  it('rejects path escape attempts', () => {
    expect(() => assertAttachmentPreviewPath(root, path.join(root, '..', 'secret.png')))
      .toThrow('IMAGE_PREVIEW_PATH_ESCAPE');
  });
});
