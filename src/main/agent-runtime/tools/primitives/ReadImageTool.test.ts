import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { ToolExecutionContext } from '../../agent/AgentTool';
import { readImageTool } from './ReadImageTool';
import { withTemporaryPathAccess } from './_shared';
import { recordToolImagePreview } from '../../../conversation/ToolImagePreviewStore';

vi.mock('../../../conversation/ToolImagePreviewStore', () => ({
  recordToolImagePreview: vi.fn(async () => ({
    previewId: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    toolCallId: 'img-1',
    fileName: 'frame.png',
    mimeType: 'image/png',
    width: 1,
    height: 1,
  })),
}));

const PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
);

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function context(root: string, vision: 'native' | 'disabled' = 'native'): ToolExecutionContext {
  return {
    workspaceRoot: root,
    projectRootPath: root,
    projectId: 'project-1',
    sessionId: 'session-1',
    visionInputMode: vision,
  };
}

describe('ReadImageTool', () => {
  it('fails closed on non-vision routes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-read-image-'));
    roots.push(root);
    await writeFile(path.join(root, 'frame.png'), PNG_1X1);

    await expect(readImageTool.execute('img-1', { path: 'frame.png' }, undefined, undefined, context(root, 'disabled')))
      .rejects.toThrow('VISION_INPUT_UNSUPPORTED');
  });

  it('returns a text block plus image block on vision routes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-read-image-ok-'));
    roots.push(root);
    await writeFile(path.join(root, 'frame.png'), PNG_1X1);

    const result = await readImageTool.execute('img-1', { path: 'frame.png' }, undefined, undefined, context(root));
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(result.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(result.details).toMatchObject({
      mimeType: 'image/png',
      bytes: PNG_1X1.length,
      sha256: createHash('sha256').update(PNG_1X1).digest('hex'),
      imagePreviews: [{ previewId: 'aaaaaaaaaaaaaaaaaaaaaaaa', fileName: 'frame.png' }],
    });
    const image = result.content[1];
    if (image.type !== 'image') throw new Error('Expected image block');
    expect(createHash('sha256').update(Buffer.from(image.data, 'base64')).digest('hex')).toBe(result.details?.sha256);
    expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining(`sha256=${result.details?.sha256}`) });
    expect(recordToolImagePreview).toHaveBeenLastCalledWith(expect.objectContaining({ bytes: PNG_1X1 }));
  });

  it('rejects paths outside the workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-read-image-escape-'));
    roots.push(root);

    await expect(readImageTool.execute('img-2', { path: '../outside.png' }, undefined, undefined, context(root)))
      .rejects.toThrow(/超出 workspace/);
  });

  it('reads granted Knowledge image bytes without retaining access outside that call', async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), 'rdc-knowledge-image-workspace-'));
    const knowledge = await mkdtemp(path.join(os.tmpdir(), 'rdc-knowledge-image-root-'));
    roots.push(workspace, knowledge);
    const imagePath = path.join(knowledge, 'reference.png'); await writeFile(imagePath, PNG_1X1);
    const execution = { ...context(workspace), knowledgeReadRoots: [knowledge] };
    const result = await withTemporaryPathAccess(execution, [knowledge], scoped =>
      readImageTool.execute('knowledge-pixels', { path: imagePath }, undefined, undefined, scoped));
    expect(result.details).toMatchObject({ path: imagePath, sha256: createHash('sha256').update(PNG_1X1).digest('hex') });
    expect(result.content[1]).toEqual({ type: 'image', mimeType: 'image/png', data: PNG_1X1.toString('base64') });
    await expect(readImageTool.execute('not-granted', { path: imagePath }, undefined, undefined, execution)).rejects.toThrow(/超出 workspace/);
  });

  it('views an immutable extensionless raster artifact using its verified content type', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-read-image-artifact-'));
    roots.push(root);
    const fileName = 'a'.repeat(64);
    await writeFile(path.join(root, fileName), PNG_1X1);
    const result = await readImageTool.execute('img-content', { path: fileName }, undefined, undefined, context(root));
    expect(result.content[1]).toEqual({ type: 'image', mimeType: 'image/png', data: PNG_1X1.toString('base64') });
    expect(result.details).toMatchObject({ path: path.join(root, fileName), mimeType: 'image/png', bytes: PNG_1X1.length });
  });

  it.each([
    ['artifact', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')],
    ['artifact', Buffer.from('%PDF-1.7')],
    ['artifact', Buffer.from('MZ executable')],
    ['artifact', Buffer.alloc(0)],
    ['frame.exe', PNG_1X1],
    ['frame.bin', PNG_1X1],
    ['frame.svg', PNG_1X1],
    ['frame.png', Buffer.from('MZ executable')],
  ])('rejects unsupported or disguised media %s', async (fileName, bytes) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-read-image-reject-'));
    roots.push(root);
    await writeFile(path.join(root, fileName), bytes);
    await expect(readImageTool.execute('img-reject', { path: fileName }, undefined, undefined, context(root)))
      .rejects.toThrow(/ATTACHMENT_(MEDIA_UNSUPPORTED|INVALID)/);
  });
});
