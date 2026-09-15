import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KNOWLEDGE_IMAGE_DENIED, KNOWLEDGE_IMAGE_MISSING, readKnowledgeImagePreview } from './knowledgeImagePreview';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function tempRoot(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'rdc-know-preview-'));
  roots.push(root);
  return root;
}

describe('knowledge image preview', () => {
  it('returns a data URL for a file inside the space root', async () => {
    const root = tempRoot();
    const relativePath = 'cases/sample/observed.png';
    mkdirSync(path.join(root, 'cases', 'sample'), { recursive: true });
    writeFileSync(path.join(root, ...relativePath.split('/')), PNG_1X1);
    const result = await readKnowledgeImagePreview({
      spaces: [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: root }],
      spaceId: 'user',
      relativePath,
    });
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.error).toBeUndefined();
  });

  it('fails closed for missing files and path traversal', async () => {
    const root = tempRoot();
    const missing = await readKnowledgeImagePreview({
      spaces: [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: root }],
      spaceId: 'user',
      relativePath: 'cases/sample/missing.png',
    });
    expect(missing).toEqual({ dataUrl: null, error: KNOWLEDGE_IMAGE_MISSING });

    const denied = await readKnowledgeImagePreview({
      spaces: [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: root }],
      spaceId: 'user',
      relativePath: '../escape.png',
    });
    expect(denied).toEqual({ dataUrl: null, error: KNOWLEDGE_IMAGE_DENIED });
  });
});
