import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const { readSession } = vi.hoisted(() => ({
  readSession: vi.fn(),
}));

vi.mock('../sessions/StorageAdapter', () => ({
  storageAdapter: { readSession },
}));

import { readToolImagePreviewDataUrl, recordToolImagePreview } from './ToolImagePreviewStore';

const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
);

const roots: string[] = [];
afterEach(async () => {
  readSession.mockReset();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ToolImagePreviewStore', () => {
  it('records a thumbnail and returns a data URL for the owning session', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdx-image-preview-'));
    roots.push(sessionPath);
    readSession.mockReturnValue({ sessionPath });

    const recorded = await recordToolImagePreview({
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      fileName: 'frame.png',
      bytes: PNG_1X1,
      mimeType: 'image/png',
    });

    expect(recorded.previewId).toMatch(/^[a-f0-9]{24}$/u);
    const dataUrl = readToolImagePreviewDataUrl('session-1', recorded.previewId);
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    const written = await readFile(path.join(sessionPath, 'image-previews', `${recorded.previewId}.png`));
    expect(written.length).toBeGreaterThan(0);
  });

  it('rejects spoofed magic bytes', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdx-image-fake-'));
    roots.push(sessionPath);
    readSession.mockReturnValue({ sessionPath });

    await expect(recordToolImagePreview({
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      fileName: 'frame.png',
      bytes: Buffer.from('not-an-image'),
      mimeType: 'image/png',
    })).rejects.toThrow(/IMAGE_PREVIEW_INVALID|magic bytes/i);
  });

  it('rejects path-escaping preview ids', () => {
    readSession.mockReturnValue({ sessionPath: os.tmpdir() });
    expect(() => readToolImagePreviewDataUrl('session-1', '../secret')).toThrow('IMAGE_PREVIEW_INVALID_ID');
  });

  it('fails closed when the session directory is missing', () => {
    readSession.mockReturnValue(null);
    expect(() => readToolImagePreviewDataUrl('missing', 'aaaaaaaaaaaaaaaaaaaaaaaa')).toThrow(
      'IMAGE_PREVIEW_SESSION_NOT_FOUND',
    );
  });

  it('validates source-path attachments before recording', async () => {
    const sessionPath = await mkdtemp(path.join(os.tmpdir(), 'rdx-image-src-'));
    roots.push(sessionPath);
    const sourcePath = path.join(sessionPath, 'spoof.png');
    await writeFile(sourcePath, Buffer.from('GIF89a-not-png'));
    readSession.mockReturnValue({ sessionPath });

    await expect(recordToolImagePreview({
      sessionId: 'session-1',
      toolCallId: 'tool-1',
      fileName: 'spoof.png',
      sourcePath,
      mimeType: 'image/png',
    })).rejects.toThrow(/ATTACHMENT_INVALID|magic bytes/i);
  });
});
