import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { classifyAttachmentBytes } from './attachmentClassify';
import { hydrateFrozenUserContent, materializeAgentUserInput } from './ConversationAttachmentMaterializer';
import { AttachmentStagingService } from './AttachmentStagingService';
import { assertAttachmentPreviewPath } from './attachmentPreview';
import { toRejectedSendResult } from './conversationSendRejection';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rdc-att-hard-'));

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(tempRoot, { recursive: true });
});

describe('attachment pipeline hardening', () => {
  it('keeps prepare/run inline text identical when physical directories differ', async () => {
    const stagingDir = path.join(tempRoot, 'staging');
    const sessionDir = path.join(tempRoot, 'session', 'attachments');
    fs.mkdirSync(stagingDir, { recursive: true });
    fs.mkdirSync(sessionDir, { recursive: true });
    const bytes = Buffer.from('# notes\nhello from staging\n');
    const stagingPath = path.join(stagingDir, 'notes.md');
    const sessionPath = path.join(sessionDir, 'notes.md');
    fs.writeFileSync(stagingPath, bytes);
    fs.writeFileSync(sessionPath, bytes);
    const planned = {
      attachmentId: 'att_1',
      kind: 'file' as const,
      layer: 'text' as const,
      fileName: 'notes.md',
      filePath: sessionPath,
      mimeType: 'text/markdown',
      size: bytes.byteLength,
    };
    const prepared = await materializeAgentUserInput('inspect', [{
      ...planned,
      readPath: stagingPath,
    }], 'disabled', { includeImageData: false, contextBudgetTokens: 80_000 });
    const hydrated = await hydrateFrozenUserContent(
      prepared.content,
      prepared.attachmentManifest,
      [{
        ...planned,
        sessionId: 'sess',
        projectId: 'proj',
        createdAt: Date.now(),
      }],
    );
    const preparedText = typeof prepared.content === 'string'
      ? prepared.content
      : prepared.content[0]?.type === 'text' ? prepared.content[0].text : '';
    const runningText = typeof hydrated === 'string'
      ? hydrated
      : hydrated[0]?.type === 'text' ? hydrated[0].text : '';
    expect(preparedText).toContain(sessionPath);
    expect(preparedText).not.toContain(stagingPath);
    expect(runningText).toBe(preparedText);
  });

  it('fails closed when the frozen manifest does not match committed attachments', async () => {
    await expect(hydrateFrozenUserContent('inspect', [{
      attachmentId: 'att_1',
      fileName: 'notes.md',
      filePath: path.join(tempRoot, 'missing.md'),
      mimeType: 'text/markdown',
      size: 12,
      layer: 'text',
      kind: 'file',
    }], [])).rejects.toThrow('ATTACHMENT_INVALID');
  });

  it('rejects a PE executable even when the file is renamed to .txt', () => {
    const classification = classifyAttachmentBytes('readme.txt', Buffer.from('MZ\x90\x00fake-pe'));
    expect(classification.rejectCode).toBe('ATTACHMENT_EXECUTABLE_DENIED');
  });

  it('rejects attachment errors as non-retryable preflight failures', () => {
    const rejected = toRejectedSendResult(
      'req-1',
      new Error('ATTACHMENT_LIMIT_EXCEEDED: too many attachments'),
    );
    expect(rejected.status).toBe('rejected');
    if (rejected.status !== 'rejected') return;
    expect(rejected.error.code).toBe('ATTACHMENT_LIMIT_EXCEEDED');
    expect(rejected.error.retryable).toBe(false);
  });
});

describe('staging quota and preview realpath', () => {
  it('releases staged files for a composer scope', async () => {
    const root = path.join(tempRoot, 'quota-root');
    fs.mkdirSync(root, { recursive: true });
    const service = new AttachmentStagingService();
    const original = service.stagingRoot.bind(service);
    service.stagingRoot = () => root;
    const sourcePath = path.join(tempRoot, 'plain.txt');
    fs.writeFileSync(sourcePath, 'abc');
    const [descriptor] = await service.stage([{ sourcePath }], 'project-a:session-1');
    expect(descriptor.error).toBeUndefined();
    expect(service.releaseByComposerScope('project-a:session-1')).toEqual([descriptor.stagingId]);
    expect(service.get(descriptor.stagingId)).toBeUndefined();
    service.stagingRoot = original;
  });

  it('rejects a junction/symlink preview path', () => {
    const root = path.join(tempRoot, 'preview-root');
    const outside = path.join(tempRoot, 'outside');
    fs.mkdirSync(path.join(root, 'attachments'), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    const secret = path.join(outside, 'secret.png');
    fs.writeFileSync(secret, 'png');
    const link = path.join(root, 'attachments', 'escaped');
    try {
      fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      return;
    }
    expect(() => assertAttachmentPreviewPath(
      path.join(root, 'attachments'),
      path.join(link, 'secret.png'),
    )).toThrow(/IMAGE_PREVIEW_PATH_ESCAPE|symlink/i);
  });
});

it('carries material context into the actual input and rejects changed committed bytes', async () => {
  const filePath = path.join(tempRoot, 'constraint.md'); const text = 'No reference image; preserve normal highlights.';
  fs.writeFileSync(filePath, text);
  const material = { intent: 'Only tear duct bright dots', documentLocation: 'Section 2, paragraph 3', comparison: { group: 'eye', role: 'baseline' as const, conditions: 'same camera and exposure' } };
  const record = { attachmentId: 'material', fileName: 'constraint.md', filePath, sourceHash: createHash('sha256').update(text).digest('hex'), material, kind: 'file' as const, layer: 'text' as const, mimeType: 'text/markdown', size: Buffer.byteLength(text), sessionId: 'session', projectId: 'project', createdAt: 1 };
  const input = await materializeAgentUserInput('help', [record], 'disabled');
  expect(JSON.stringify(input.content)).toContain('Only tear duct bright dots');
  expect(JSON.stringify(input.content)).toContain('not verified observations or authorization');
  expect(input.attachmentManifest[0]).toMatchObject({ material, sourceHash: record.sourceHash });
  expect(await hydrateFrozenUserContent(input.content, input.attachmentManifest, [record])).toEqual(input.content);
  fs.writeFileSync(filePath, 'Changed after prepare');
  await expect(hydrateFrozenUserContent(input.content, input.attachmentManifest, [record])).rejects.toThrow('ATTACHMENT_SOURCE_CHANGED');
});
