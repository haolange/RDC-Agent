import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '../../agent/AgentTool';
import { readImageTool } from './ReadImageTool';

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
      imagePreviews: [{ previewId: 'aaaaaaaaaaaaaaaaaaaaaaaa', fileName: 'frame.png' }],
    });
  });

  it('rejects paths outside the workspace', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'rdc-read-image-escape-'));
    roots.push(root);

    await expect(readImageTool.execute('img-2', { path: '../outside.png' }, undefined, undefined, context(root)))
      .rejects.toThrow(/超出 workspace/);
  });
});
