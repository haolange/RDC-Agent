import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDisposableCandidateService } from './KnowledgeCandidateService';
import { KnowledgeWriteService } from './KnowledgeWriteService';
import { ingestKnowledgeFromPath } from './knowledgeIngest';

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
    const candidates = createDisposableCandidateService(tempRoot('rdc-know-img-sess-'));
    const result = await candidates.ingestPathToStaging(path.join(sourceRoot, 'case.yaml'), {
      sessionId: 'sess-img',
      spaceId: 'user',
    });
    expect(result.status).toBe('draft');
    expect(result.record?.images).toEqual([
      { relativePath: 'cases/img-case/observed.png', role: 'observed' },
      { relativePath: 'cases/img-case/reference.png', role: 'reference' },
    ]);
    expect(result.missingAssets).toEqual([]);
    const write = new KnowledgeWriteService({
      listSpaces: () => [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: spaceRoot }],
      now: () => new Date('2026-09-01T00:00:00.000Z'),
    });
    await write.write({
      spaceId: 'user',
      card: result.record!,
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
      approvalAlreadyConsumed: true,
    });
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
    expect(result.status).toBe('draft');
    expect(result.record?.images).toEqual([
      { relativePath: 'cases/missing-case/observed.png', role: 'observed' },
      { relativePath: 'cases/missing-case/reference.png', role: 'reference' },
    ]);
    expect(result.missingAssets).toEqual([
      'cases/missing-case/observed.png',
      'cases/missing-case/reference.png',
    ]);
    expect(result.stagedImages).toBeUndefined();
  });
});
