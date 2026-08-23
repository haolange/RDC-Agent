import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-att-stage-'));

vi.mock('../runtime/AppPathService', () => ({
  appPathService: {
    getAppStatePaths: () => ({
      attachmentStagingPath: path.join(tempRoot, 'staging', 'attachments'),
    }),
  },
}));

import { AttachmentStagingService } from './AttachmentStagingService';

const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
);

describe('AttachmentStagingService', () => {
  let service: AttachmentStagingService;

  beforeEach(() => {
    service = new AttachmentStagingService();
    service.clearAll();
  });

  afterEach(() => {
    service.clearAll();
  });

  it('stages a path-based text file with real size and text layer', async () => {
    const sourcePath = path.join(tempRoot, 'notes.md');
    fs.writeFileSync(sourcePath, '# hello\n');
    const [descriptor] = await service.stage([{ sourcePath, fileName: 'notes.md' }], 'project:session');
    expect(descriptor.error).toBeUndefined();
    expect(descriptor.layer).toBe('text');
    expect(descriptor.kind).toBe('file');
    expect(descriptor.size).toBe(8);
    expect(fs.existsSync(descriptor.sourcePath)).toBe(true);
    expect(service.get(descriptor.stagingId)?.bytesPath).toBe(descriptor.sourcePath);
  });

  it('stages bytes as a native image and exposes a preview id', async () => {
    const [descriptor] = await service.stage([{
      fileName: 'dot.png',
      mimeType: 'image/png',
      bytesBase64: PNG_1X1.toString('base64'),
    }], 'project:session');
    expect(descriptor.layer).toBe('image');
    expect(descriptor.kind).toBe('image');
    expect(descriptor.previewId).toBe(descriptor.stagingId);
    expect(service.readPreviewDataUrl(descriptor.previewId ?? '')).toMatch(/^data:image\/png;base64,/);
  });

  it('rejects .rdc captures and executables without writing files', async () => {
    const rdcPath = path.join(tempRoot, 'frame.rdc');
    fs.writeFileSync(rdcPath, 'rdc');
    const [capture, executable] = await service.stage([
      { sourcePath: rdcPath, fileName: 'frame.rdc' },
      { fileName: 'setup.exe', bytesBase64: Buffer.from('MZ').toString('base64') },
    ], 'project:session');
    expect(capture.error?.code).toBe('ATTACHMENT_CAPTURE_USE_PROJECT_IMPORT');
    expect(executable.error?.code).toBe('ATTACHMENT_EXECUTABLE_DENIED');
    expect(capture.sourcePath).toBe('');
    expect(service.get(capture.stagingId)).toBeUndefined();
  });

  it('releases staged files by id', async () => {
    const sourcePath = path.join(tempRoot, 'plain.txt');
    fs.writeFileSync(sourcePath, 'abc');
    const [descriptor] = await service.stage([{ sourcePath }], 'project:session');
    expect(fs.existsSync(descriptor.sourcePath)).toBe(true);
    expect(service.release([descriptor.stagingId])).toEqual([descriptor.stagingId]);
    expect(fs.existsSync(descriptor.sourcePath)).toBe(false);
    expect(service.get(descriptor.stagingId)).toBeUndefined();
  });
});
