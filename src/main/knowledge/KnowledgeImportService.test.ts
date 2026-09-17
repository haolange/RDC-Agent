import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KnowledgeDraftMigrationConflictError } from './knowledgeErrors';
import { createDisposableImportService } from './KnowledgeImportService';
import { hashKnowledgeContent } from './KnowledgeDurableStore';
import { KNOWLEDGE_STATE_FILE } from './knowledgeStateSchema';
import type { KnowledgeCardRecord } from '@shared/types/knowledge';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function caseYaml(caseId: string, title: string, extra = 'darker than reference'): string {
  return [
    `case_id: ${caseId}`,
    `title: ${title}`,
    'meta:',
    '  status: fixed',
    `symptoms: ${extra}`,
  ].join('\n');
}

function leftoverCard(caseId: string, sourceHash: string): KnowledgeCardRecord {
  return {
    cardId: `user:cases/${caseId}.md`,
    spaceId: 'user',
    relativePath: `cases/${caseId}.md`,
    type: 'case',
    lifecycle: 'draft',
    title: 'Leftover draft',
    scope: {},
    relations: [],
    body: 'Leftover body',
    caseId,
    sourceHash,
  };
}

describe('KnowledgeImportService', () => {
  it('writes a draft card into an empty space and never creates a Candidate', async () => {
    const spaceRoot = tempRoot('rdc-know-import-empty-');
    const importer = createDisposableImportService({ spaceRoot });
    const result = await importer.importToSpace({
      spaceId: 'user',
      source: caseYaml('empty-case', 'Empty space card'),
    });
    expect(result.candidateCreated).toBe(false);
    expect(result.verified).toBe(false);
    expect(result.items[0]?.status).toBe('draft');
    expect(result.items[0]?.reason).toBeUndefined();
    expect(result.items[0]?.record?.lifecycle).toBe('draft');
    expect(result.items[0]?.record?.title).toBe('Empty space card');
    expect(existsSync(path.join(spaceRoot, 'cases', 'empty-case.md'))).toBe(true);
    expect(result.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('treats the same sourceHash already in the space as already-present', async () => {
    const spaceRoot = tempRoot('rdc-know-import-idem-');
    const importer = createDisposableImportService({ spaceRoot });
    const source = caseYaml('same-hash', 'Same hash card');
    const first = await importer.importToSpace({ spaceId: 'user', source });
    const before = readFileSync(path.join(spaceRoot, 'cases', 'same-hash.md'), 'utf8');
    const second = await importer.importToSpace({ spaceId: 'user', source });
    expect(first.items[0]?.status).toBe('draft');
    expect(second.items[0]?.status).toBe('draft');
    expect(second.items[0]?.reason).toBe('already-present');
    expect(second.items[0]?.existingCardId).toBe(first.items[0]?.record?.cardId);
    expect(second.items[0]?.record?.title).toBe('Same hash card');
    expect(readFileSync(path.join(spaceRoot, 'cases', 'same-hash.md'), 'utf8')).toBe(before);
  });

  it('conflicts on the same identity with a different sourceHash and keeps the existing card', async () => {
    const spaceRoot = tempRoot('rdc-know-import-conflict-');
    const importer = createDisposableImportService({ spaceRoot });
    const first = await importer.importToSpace({
      spaceId: 'user',
      source: caseYaml('dup-case', 'Original title', 'first symptoms'),
    });
    const before = readFileSync(path.join(spaceRoot, 'cases', 'dup-case.md'), 'utf8');
    const second = await importer.importToSpace({
      spaceId: 'user',
      source: caseYaml('dup-case', 'Changed title', 'second symptoms'),
    });
    expect(first.items[0]?.status).toBe('draft');
    expect(second.items[0]?.status).toBe('conflict');
    expect(second.items[0]?.reason).toBe('duplicate-case-id');
    expect(second.items[0]?.existingCardId).toBe(first.items[0]?.record?.cardId);
    expect(second.items[0]?.existingCaseId).toBe('dup-case');
    expect(second.items[0]?.record?.title).toBe('Changed title');
    expect(readFileSync(path.join(spaceRoot, 'cases', 'dup-case.md'), 'utf8')).toBe(before);
  });

  it('quarantines secrets and absolute paths without writing the space', async () => {
    const spaceRoot = tempRoot('rdc-know-import-q-');
    const importer = createDisposableImportService({ spaceRoot });
    const secret = await importer.importToSpace({
      spaceId: 'user',
      source: caseYaml('secret-case', 'Secret', 'api_key leaked'),
    });
    const leaked = await importer.importToSpace({
      spaceId: 'user',
      source: caseYaml('abs-case', 'Abs', 'see C:/capture.rdc'),
    });
    expect(secret.items[0]?.status).toBe('quarantine');
    expect(secret.items[0]?.reason).toBe('secret-detected');
    expect(leaked.items[0]?.status).toBe('quarantine');
    expect(leaked.items[0]?.reason).toBe('absolute-path');
    expect(readdirSync(spaceRoot)).toEqual([]);
  });

  it('flushes leftover session drafts into the space once', async () => {
    const spaceRoot = tempRoot('rdc-know-import-mig-');
    const sessionRoot = tempRoot('rdc-know-import-sess-');
    const importer = createDisposableImportService({ spaceRoot, sessionRoot });
    const sourceHash = 'ab'.repeat(32);
    const card = leftoverCard('mig-case', sourceHash);
    const sessionDir = path.join(sessionRoot, 'sess-mig');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(path.join(sessionDir, KNOWLEDGE_STATE_FILE), `${JSON.stringify({
      schemaVersion: '1',
      drafts: [{
        revision: 1,
        contentHash: hashKnowledgeContent(card),
        card,
        sourceHash,
      }],
      candidates: [],
      reviews: [],
    }, null, 2)}\n`, 'utf8');
    await importer.migrateSessionDrafts('sess-mig');
    expect(existsSync(path.join(spaceRoot, 'cases', 'mig-case.md'))).toBe(true);
    const persisted = JSON.parse(readFileSync(path.join(sessionDir, KNOWLEDGE_STATE_FILE), 'utf8')) as {
      schemaVersion: string;
      drafts?: unknown[];
    };
    expect(persisted.schemaVersion).toBe('1');
    expect(persisted.drafts).toBeUndefined();
  });

  it('keeps leftover drafts visible when the space already has a different source', async () => {
    const spaceRoot = tempRoot('rdc-know-import-mig-conflict-');
    const sessionRoot = tempRoot('rdc-know-import-sess-conflict-');
    const importer = createDisposableImportService({ spaceRoot, sessionRoot });
    await importer.importToSpace({
      spaceId: 'user',
      source: caseYaml('clash-case', 'Space card', 'space symptoms'),
    });
    const leftoverHash = 'cd'.repeat(32);
    const card = leftoverCard('clash-case', leftoverHash);
    const sessionDir = path.join(sessionRoot, 'sess-clash');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(path.join(sessionDir, KNOWLEDGE_STATE_FILE), `${JSON.stringify({
      schemaVersion: '1',
      drafts: [{
        revision: 1,
        contentHash: hashKnowledgeContent(card),
        card,
        sourceHash: leftoverHash,
      }],
      candidates: [],
      reviews: [],
    }, null, 2)}\n`, 'utf8');
    await expect(importer.migrateSessionDrafts('sess-clash')).rejects.toBeInstanceOf(KnowledgeDraftMigrationConflictError);
    const persisted = JSON.parse(readFileSync(path.join(sessionDir, KNOWLEDGE_STATE_FILE), 'utf8')) as {
      schemaVersion: string;
      drafts: unknown[];
    };
    expect(persisted.schemaVersion).toBe('1');
    expect(persisted.drafts).toHaveLength(1);
  });
});
