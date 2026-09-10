import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { materializeAgentUserInput } from './ConversationAttachmentMaterializer';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-att-mat-'));

beforeEach(() => fs.mkdirSync(tempRoot, { recursive: true }));
afterEach(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

describe('conversation attachment materialization', () => {
  it('inlines text files and keeps binary files as tool-visible paths', async () => {
    const textPath = path.join(tempRoot, 'notes.md');
    const binaryPath = path.join(tempRoot, 'sheet.xlsx');
    fs.writeFileSync(textPath, '# title\nhello');
    fs.writeFileSync(binaryPath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]));
    const result = await materializeAgentUserInput('inspect', [
      {
        kind: 'file',
        layer: 'text',
        fileName: 'notes.md',
        filePath: textPath,
        mimeType: 'text/markdown',
        size: fs.statSync(textPath).size,
      },
      {
        kind: 'file',
        layer: 'binary',
        fileName: 'sheet.xlsx',
        filePath: binaryPath,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: fs.statSync(binaryPath).size,
      },
    ], 'disabled', false);
    const text = typeof result.content === 'string' ? result.content : result.content[0]?.type === 'text' ? result.content[0].text : '';
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
    const textPath = path.join(tempRoot, 'repeat.md');
    fs.writeFileSync(textPath, Array.from({ length: 80 }, (_, index) => `line-${index} content`).join('\n'));
    const attachment = {
      kind: 'file' as const,
      layer: 'text' as const,
      fileName: 'repeat.md',
      filePath: textPath,
      mimeType: 'text/markdown',
      size: fs.statSync(textPath).size,
    };
    const prepared = await materializeAgentUserInput('inspect', [attachment], 'disabled', false);
    const running = await materializeAgentUserInput('inspect', [attachment], 'disabled', true);
    const preparedText = typeof prepared.content === 'string' ? prepared.content : prepared.content[0]?.type === 'text' ? prepared.content[0].text : '';
    const runningText = typeof running.content === 'string' ? running.content : running.content[0]?.type === 'text' ? running.content[0].text : '';
    expect(runningText).toBe(preparedText);
    expect(preparedText).toContain('line-0 content');
  });

  it('writes an explicit diagnostic when a PDF has no text layer', async () => {
    const pdfPath = path.join(tempRoot, 'scan.pdf');
    fs.writeFileSync(pdfPath, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
    const result = await materializeAgentUserInput('inspect', [{
      kind: 'file',
      layer: 'pdf',
      fileName: 'scan.pdf',
      filePath: pdfPath,
      mimeType: 'application/pdf',
      size: fs.statSync(pdfPath).size,
    }], 'disabled', false);
    const text = typeof result.content === 'string' ? result.content : result.content[0]?.type === 'text' ? result.content[0].text : '';
    expect(text).toMatch(/could not be loaded|no extractable text layer/i);
    expect(text).toContain('scan.pdf');
  });
});
