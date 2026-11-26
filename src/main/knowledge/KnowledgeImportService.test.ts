import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@shared/errors/appError';
import { expectMonotonicProgress } from '../testing/knowledgeProgress';
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
  return [`case_id: ${caseId}`, `title: ${title}`, 'meta:', '  status: fixed', `symptoms: ${extra}`].join('\n');
}

function packageYaml(titles: string[]): string {
  return [
    'schema: rdc.knowledge-package/1',
    'cards:',
    ...titles.flatMap((title, index) => [
      `  - relativePath: facts/package-${index}.md`,
      `    title: ${title}`,
      '    type: fact',
      `    body: ${title} body`,
    ]),
  ].join('\n');
}

/** Every card file in the space with its bytes; the index snapshot is derived and left out. */
function cardFiles(root: string, dir = root): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, cardFiles(root, absolute));
    else if (entry.name.endsWith('.md')) files[path.relative(root, absolute)] = readFileSync(absolute, 'utf8');
  }
  return files;
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

  it('previews the same judgments the import makes without writing anything', async () => {
    const spaceRoot = tempRoot('rdc-know-import-preview-');
    const importer = createDisposableImportService({ spaceRoot });
    await importer.importToSpace({ spaceId: 'user', source: caseYaml('kept-case', 'Kept', 'first symptoms') });
    const before = readdirSync(path.join(spaceRoot, 'cases')).sort();
    const changed = await importer.previewImport({
      spaceId: 'user',
      source: caseYaml('kept-case', 'Kept, edited', 'second symptoms'),
    });
    expect(changed.items.map((item) => [item.status, item.reason])).toEqual([['conflict', 'duplicate-case-id']]);
    const fresh = await importer.previewImport({ spaceId: 'user', source: caseYaml('new-case', 'New card') });
    expect(fresh.items.map((item) => [item.status, item.reason, item.record?.title])).toEqual([
      ['draft', undefined, 'New card'],
    ]);
    expect(readdirSync(path.join(spaceRoot, 'cases')).sort()).toEqual(before);
    const imported = await importer.importToSpace({ spaceId: 'user', source: caseYaml('new-case', 'New card') });
    expect(imported.items.map((item) => [item.status, item.reason])).toEqual(
      fresh.items.map((item) => [item.status, item.reason]),
    );
  });

  it('cancelled between cards, removes the cards it already wrote and leaves the space as it was', async () => {
    const spaceRoot = tempRoot('rdc-know-import-cancel-');
    const importer = createDisposableImportService({ spaceRoot });
    await importer.importToSpace({ spaceId: 'user', source: caseYaml('kept-case', 'Kept') });
    const before = cardFiles(spaceRoot);
    const controller = new AbortController();
    const events: Array<{ phase: 'reading' | 'writing' | 'indexing'; done: number; total: number }> = [];
    const source = packageYaml(['One', 'Two', 'Three']);

    await expect(
      importer.importToSpace(
        { spaceId: 'user', source },
        {
          signal: controller.signal,
          onProgress: (phase, done, total) => {
            events.push({ phase, done, total });
            if (phase === 'writing' && done === 2) controller.abort(new AppError('KNOWLEDGE_OPERATION_CANCELLED'));
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_OPERATION_CANCELLED' });

    expect(cardFiles(spaceRoot)).toEqual(before);
    expectMonotonicProgress(events);
    expect(events[0]).toEqual({ phase: 'reading', done: 0, total: 1 });
    expect(events.at(-1)).toEqual({ phase: 'writing', done: 2, total: 3 });
    // Nothing was left half-imported: the same package imports whole afterwards.
    const again = await importer.importToSpace({ spaceId: 'user', source });
    expect(again.items.map((item) => [item.status, item.reason])).toEqual([
      ['draft', undefined],
      ['draft', undefined],
      ['draft', undefined],
    ]);
    expect(Object.keys(cardFiles(spaceRoot)).sort()).toEqual([
      path.join('cases', 'kept-case.md'),
      ...[0, 1, 2].map((index) => path.join('facts', `package-${index}.md`)),
    ]);
  });

  it('quarantines secrets and absolute paths without writing the space', async () => {
    const spaceRoot = tempRoot('rdc-know-import-q-');
    const importer = createDisposableImportService({ spaceRoot });
    const secret = await importer.importToSpace({
      spaceId: 'user',
      source: caseYaml('secret-case', 'Secret', 'token: ghp_FIXTUREfixture0123456789abcdefABCDEF'),
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
    writeFileSync(
      path.join(sessionDir, KNOWLEDGE_STATE_FILE),
      `${JSON.stringify(
        {
          schemaVersion: '1',
          drafts: [
            {
              revision: 1,
              contentHash: hashKnowledgeContent(card),
              card,
              sourceHash,
            },
          ],
          candidates: [],
          reviews: [],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
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
    writeFileSync(
      path.join(sessionDir, KNOWLEDGE_STATE_FILE),
      `${JSON.stringify(
        {
          schemaVersion: '1',
          drafts: [
            {
              revision: 1,
              contentHash: hashKnowledgeContent(card),
              card,
              sourceHash: leftoverHash,
            },
          ],
          candidates: [],
          reviews: [],
        },
        null,
        2,
      )}\n`,
      'utf8',
    );
    await expect(importer.migrateSessionDrafts('sess-clash')).rejects.toBeInstanceOf(
      KnowledgeDraftMigrationConflictError,
    );
    const persisted = JSON.parse(readFileSync(path.join(sessionDir, KNOWLEDGE_STATE_FILE), 'utf8')) as {
      schemaVersion: string;
      drafts: unknown[];
    };
    expect(persisted.schemaVersion).toBe('1');
    expect(persisted.drafts).toHaveLength(1);
  });
});
