import { beforeAll, describe, expect, it } from 'vitest';
import { materializeAgentUserInput } from '../agent-runtime/attachments/ConversationAttachmentMaterializer';
import { materializedText, attachmentTempRoot, writeFileAttachment } from '../testing/attachmentTestSupport';

const tempRoot = attachmentTempRoot('rdc-att-mat-');

const EMPTY_PDF = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n';

// The first PDF read imports pdf.js and its fake worker (both MB-sized ESM). On a busy cold runner that load
// alone outlasts a test's 5 s budget, so it is paid once here through the same production path.
beforeAll(async () => {
  await materializeAgentUserInput('warm', [writeFileAttachment(tempRoot, 'warm.pdf', EMPTY_PDF, 'pdf', 'application/pdf')], 'disabled', false);
}, 60_000);

describe('conversation attachment materialization', () => {
  it('inlines text files and keeps binary files as tool-visible paths', async () => {
    const result = await materializeAgentUserInput('inspect', [
      writeFileAttachment(tempRoot, 'notes.md', '# title\nhello', 'text', 'text/markdown'),
      writeFileAttachment(tempRoot, 'sheet.xlsx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]), 'binary',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
    ], 'disabled', false);
    const text = materializedText(result.content);
    expect(text).toContain('# title');
    expect(text).toContain('sheet.xlsx');
    expect(text).toContain('binary');
    expect(result.imageTokenAdjustment).toBe(0);
  });

  it('fails closed when an image is attached to a non-vision route', async () => {
    await expect(materializeAgentUserInput('inspect', [{
      kind: 'image', layer: 'image', fileName: 'capture.png', filePath: 'capture.png', mimeType: 'image/png', size: 1024,
    }], 'disabled', false)).rejects.toThrow('VISION_INPUT_UNSUPPORTED');
  });

  it('rejects unsupported image media and estimates supported image bytes without embedding preview data', async () => {
    await expect(materializeAgentUserInput('inspect', [{
      kind: 'image', layer: 'image', fileName: 'capture.svg', filePath: 'capture.svg', mimeType: 'image/svg+xml', size: 1024,
    }], 'native', false)).rejects.toThrow('ATTACHMENT_MEDIA_UNSUPPORTED');

    const result = await materializeAgentUserInput('inspect', [{
      kind: 'image', layer: 'image', fileName: 'capture.png', filePath: 'capture.png', mimeType: 'image/png', size: 4 * 1024 * 1024,
    }], 'native', false);
    expect(result.imageTokenAdjustment).toBe(4096 - 256);
    expect(result.content).toEqual(expect.arrayContaining([
      { type: 'image', data: '', mimeType: 'image/png' },
    ]));
  });

  it('produces identical inline text for prepare and run materialization', async () => {
    const attachment = writeFileAttachment(tempRoot, 'repeat.md',
      Array.from({ length: 80 }, (_, index) => `line-${index} content`).join('\n'), 'text', 'text/markdown');
    const prepared = await materializeAgentUserInput('inspect', [attachment], 'disabled', false);
    const running = await materializeAgentUserInput('inspect', [attachment], 'disabled', true);
    const preparedText = materializedText(prepared.content);
    const runningText = materializedText(running.content);
    expect(runningText).toBe(preparedText);
    expect(preparedText).toContain('line-0 content');
  });

  it('writes an explicit diagnostic when a PDF has no text layer', async () => {
    const result = await materializeAgentUserInput('inspect', [writeFileAttachment(tempRoot, 'scan.pdf', EMPTY_PDF, 'pdf', 'application/pdf')],
      'disabled', false);
    const text = materializedText(result.content);
    expect(text).toMatch(/could not be loaded|no extractable text layer/i);
    expect(text).toContain('scan.pdf');
  });
});
