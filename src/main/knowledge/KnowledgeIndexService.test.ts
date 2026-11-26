import { mkdirSync, mkdtempSync, promises as fs, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '@shared/errors/appError';
import { expectMonotonicProgress } from '../testing/knowledgeProgress';
import { StorageIo } from '../runtime/StorageIo';
import { KnowledgeIndexService } from './KnowledgeIndexService';
import type { KnowledgeOperationPhase } from '@shared/types/knowledgeOperation';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function card(root: string, name: string, title: string): void {
  mkdirSync(path.join(root, 'facts'), { recursive: true });
  writeFileSync(path.join(root, 'facts', `${name}.md`), `---\ntitle: ${title}\ntype: fact\n---\n\n${title} body\n`);
}

describe('KnowledgeIndexService rebuild', () => {
  it('cancelled between cards, keeps the previous snapshot in use and reports monotonic progress', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'rdc-know-index-cancel-'));
    roots.push(root);
    const spaceRoot = path.join(root, 'space');
    card(spaceRoot, 'one', 'One');
    card(spaceRoot, 'two', 'Two');
    const index = new KnowledgeIndexService({
      listSpaces: () => [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: spaceRoot }],
      snapshotPath: () => path.join(root, 'knowledge-index.json'),
      storage: new StorageIo(),
      now: () => new Date('2026-11-25T09:30:00.000Z'),
      readFile: (filePath) => fs.readFile(filePath, 'utf8'),
      statMtime: async (filePath) => Math.trunc((await fs.stat(filePath)).mtimeMs),
    });
    const previous = await index.rebuild();
    card(spaceRoot, 'three', 'Three');

    const controller = new AbortController();
    const events: Array<{ phase: KnowledgeOperationPhase; done: number; total: number }> = [];
    await expect(
      index.rebuild({
        signal: controller.signal,
        onProgress: (phase, done, total) => {
          events.push({ phase, done, total });
          if (done === 2) controller.abort(new AppError('KNOWLEDGE_OPERATION_CANCELLED'));
        },
      }),
    ).rejects.toMatchObject({ code: 'KNOWLEDGE_OPERATION_CANCELLED' });

    expect(events).toEqual([0, 1, 2].map((done) => ({ phase: 'indexing', done, total: 3 })));
    expectMonotonicProgress(events);
    expect(index.getSnapshot()).toEqual(previous);
    expect(index.getSnapshot()?.cards.map((entry) => entry.title)).toEqual(['One', 'Two']);
    await expect(index.isSnapshotStale()).resolves.toBe(true);
    expect((await index.getOrRebuild()).cards.map((entry) => entry.title)).toEqual(['One', 'Three', 'Two']);
  });
});
