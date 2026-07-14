import { describe, expect, it } from 'vitest';
import { materializeAgentUserInput } from './ConversationAttachmentMaterializer';

describe('conversation attachment materialization', () => {
  it('keeps ordinary files as explicit tool-visible paths without requiring vision', async () => {
    const result = await materializeAgentUserInput('inspect', [{
      kind: 'file',
      fileName: '眼睛泪腺白点.rdc',
      filePath: 'D:/Projects/RDX/RDC-Agent/眼睛泪腺白点.rdc',
      mimeType: 'application/octet-stream',
      size: 42,
    }], 'disabled', false);
    expect(JSON.stringify(result.content)).toContain('眼睛泪腺白点.rdc');
    expect(result.imageTokenAdjustment).toBe(0);
  });

  it('fails closed when an image is attached to a non-vision route', async () => {
    await expect(materializeAgentUserInput('inspect', [{
      kind: 'image', fileName: 'capture.png', filePath: 'capture.png', mimeType: 'image/png', size: 1024,
    }], 'disabled', false)).rejects.toThrow('VISION_INPUT_UNSUPPORTED');
  });

  it('rejects unsupported image media and estimates supported image bytes without embedding preview data', async () => {
    await expect(materializeAgentUserInput('inspect', [{
      kind: 'image', fileName: 'capture.svg', filePath: 'capture.svg', mimeType: 'image/svg+xml', size: 1024,
    }], 'native', false)).rejects.toThrow('ATTACHMENT_MEDIA_UNSUPPORTED');

    const result = await materializeAgentUserInput('inspect', [{
      kind: 'image', fileName: 'capture.png', filePath: 'capture.png', mimeType: 'image/png', size: 4 * 1024 * 1024,
    }], 'native', false);
    expect(result.imageTokenAdjustment).toBe(4096 - 256);
    expect(result.content).toEqual(expect.arrayContaining([
      { type: 'image', data: '', mimeType: 'image/png' },
    ]));
  });
});
