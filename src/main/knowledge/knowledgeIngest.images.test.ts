import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { zipSync } from 'fflate';
import { KNOWLEDGE_PACKAGE_SCHEMA } from '@shared/types/knowledgeExport';
import { createDisposableImportService } from './KnowledgeImportService';
import { ingestKnowledge, ingestKnowledgeFromPath } from './knowledgeIngest';
import { KNOWLEDGE_PACKAGE_ZIP_MAX_UNCOMPRESSED, utf8ToZip, zipKnowledgeFiles } from './knowledgeZip';

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function caseYaml(caseId: string): string {
  return [
    `case_id: ${caseId}`,
    'title: Image ingest case',
    'meta:',
    '  status: fixed',
    'symptoms: darker than reference',
    'assets:',
    '  images:',
    '    - { file: "observed.png", role: "observed" }',
    '    - { file: "reference.png", role: "reference" }',
  ].join('\n');
}

describe('knowledge import images', () => {
  it('stages sibling images and writes them next to the card on confirm', async () => {
    const sourceRoot = tempRoot('rdc-know-img-src-');
    const spaceRoot = tempRoot('rdc-know-img-space-');
    writeFileSync(path.join(sourceRoot, 'case.yaml'), caseYaml('img-case'), 'utf8');
    writeFileSync(path.join(sourceRoot, 'observed.png'), PNG_1X1);
    writeFileSync(path.join(sourceRoot, 'reference.png'), PNG_1X1);
    const importer = createDisposableImportService({ spaceRoot });
    const result = await importer.importToSpace({
      spaceId: 'user',
      filePath: path.join(sourceRoot, 'case.yaml'),
    });
    expect(result.items[0]?.status).toBe('draft');
    expect(result.items[0]?.record?.images).toEqual([
      { relativePath: 'cases/img-case/observed.png', role: 'observed' },
      { relativePath: 'cases/img-case/reference.png', role: 'reference' },
    ]);
    expect(result.items[0]?.missingAssets).toEqual([]);
    expect(existsSync(path.join(spaceRoot, 'cases', 'img-case.md'))).toBe(true);
    expect(existsSync(path.join(spaceRoot, 'cases', 'img-case', 'observed.png'))).toBe(true);
    expect(existsSync(path.join(spaceRoot, 'cases', 'img-case', 'reference.png'))).toBe(true);
  });

  it('keeps declared image paths when siblings are missing', async () => {
    const sourceRoot = tempRoot('rdc-know-img-missing-');
    mkdirSync(sourceRoot, { recursive: true });
    writeFileSync(path.join(sourceRoot, 'case.yaml'), caseYaml('missing-case'), 'utf8');
    const result = await ingestKnowledgeFromPath(path.join(sourceRoot, 'case.yaml'), {
      spaceId: 'user',
      sessionId: 'sess-missing',
    });
    expect(result.items[0]?.status).toBe('draft');
    expect(result.items[0]?.record?.images).toEqual([
      { relativePath: 'cases/missing-case/observed.png', role: 'observed' },
      { relativePath: 'cases/missing-case/reference.png', role: 'reference' },
    ]);
    expect(result.items[0]?.missingAssets).toEqual([
      'cases/missing-case/observed.png',
      'cases/missing-case/reference.png',
    ]);
    expect(result.stagedImagesByCardId).toBeUndefined();
  });

  it('marks declared package images missing when only YAML is pasted', () => {
    const pasted = [
      `schema: ${KNOWLEDGE_PACKAGE_SCHEMA}`,
      'exportedAt: 2026-09-01T00:00:00.000Z',
      'cards:',
      '  - cardId: user:cases/paste-1.md',
      '    relativePath: cases/paste-1.md',
      '    type: case',
      '    lifecycle: verified',
      '    title: Pasted card',
      '    body: Body',
      '    images:',
      '      - { relativePath: cases/paste-1/observed.png, role: observed }',
    ].join('\n');
    const result = ingestKnowledge(pasted, { spaceId: 'user' });
    expect(result.items[0]?.status).toBe('draft');
    expect(result.items[0]?.missingAssets).toEqual(['cases/paste-1/observed.png']);
    expect(result.items[0]?.reason).toBe('missing-assets');
  });

  it('ingests every card from a multi-card package zip', async () => {
    const sourceRoot = tempRoot('rdc-know-img-multi-');
    const zipPath = path.join(sourceRoot, 'pack.zip');
    const yaml = [
      `schema: ${KNOWLEDGE_PACKAGE_SCHEMA}`,
      'exportedAt: 2026-09-01T00:00:00.000Z',
      'cards:',
      '  - cardId: user:cases/a.md',
      '    relativePath: cases/a.md',
      '    type: case',
      '    lifecycle: verified',
      '    title: Card A',
      '    body: Body A',
      '    images:',
      '      - { relativePath: cases/a/observed.png, role: observed }',
      '  - cardId: user:cases/b.md',
      '    relativePath: cases/b.md',
      '    type: case',
      '    lifecycle: verified',
      '    title: Card B',
      '    body: Body B',
    ].join('\n');
    writeFileSync(zipPath, zipKnowledgeFiles([
      { name: 'knowledge.yaml', data: utf8ToZip(yaml) },
      { name: 'cases/a/observed.png', data: PNG_1X1 },
    ]));
    const spaceRoot = tempRoot('rdc-know-img-multi-space-');
    const importer = createDisposableImportService({ spaceRoot });
    const result = await importer.importToSpace({ spaceId: 'user', filePath: zipPath });
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.record?.title)).toEqual(['Card A', 'Card B']);
    expect(result.items[0]?.missingAssets).toEqual([]);
    expect(result.items[1]?.missingAssets).toEqual([]);
    expect(existsSync(path.join(spaceRoot, 'cases', 'a.md'))).toBe(true);
    expect(existsSync(path.join(spaceRoot, 'cases', 'b.md'))).toBe(true);
  });

  it('quarantines zip-slip entries and oversized zip payloads', async () => {
    const sourceRoot = tempRoot('rdc-know-img-zip-');
    const slipPath = path.join(sourceRoot, 'slip.zip');
    writeFileSync(slipPath, zipSync({
      '../escape.png': PNG_1X1,
      'knowledge.yaml': utf8ToZip(`schema: ${KNOWLEDGE_PACKAGE_SCHEMA}\ncards: []\n`),
    }));
    const slipped = await ingestKnowledgeFromPath(slipPath, { spaceId: 'user' });
    expect(slipped.items[0]?.status).toBe('quarantine');
    expect(slipped.items[0]?.reason).toBe('zip-path-invalid');

    const oversized = Buffer.alloc(KNOWLEDGE_PACKAGE_ZIP_MAX_UNCOMPRESSED + 1, 0x61);
    const huge = await ingestKnowledgeFromPath('huge.zip', {
      io: {
        stat: async () => ({ mtimeMs: 1, size: oversized.length }),
        readFile: async () => oversized,
      },
    });
    expect(huge.items[0]?.status).toBe('quarantine');
    expect(huge.items[0]?.reason).toBe('source-too-large');
  });
});
