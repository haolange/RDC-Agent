import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import type { KnowledgeCardRecord, KnowledgeSpace } from '@shared/types/knowledge';
import { StorageIo } from '../sessions/StorageIo';
import { createDisposableCandidateService } from './KnowledgeCandidateService';
import { KnowledgeCompileService } from './KnowledgeCompileService';
import { KnowledgeIndexService } from './KnowledgeIndexService';
import { KnowledgeQueryService } from './KnowledgeQueryService';
import { KnowledgeWriteService } from './KnowledgeWriteService';
import { KnowledgeHumanConfirmationRequiredError, KnowledgeLifecycleError } from './knowledgeErrors';
import { serializeKnowledgeCard } from './knowledgeCardSchema';

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'rdc-knowledge-'));
}

function space(rootPath: string): KnowledgeSpace {
  return { spaceId: 'user', kind: 'user', label: 'User', rootPath };
}

function draftCard(rootRelative = 'facts/sample.md'): KnowledgeCardRecord {
  return {
    cardId: `user:${rootRelative}`,
    spaceId: 'user',
    relativePath: rootRelative,
    type: 'fact',
    lifecycle: 'draft',
    title: 'Sample fact',
    scope: { platform: 'Android', api: 'Vulkan' },
    relations: [],
    body: '# Sample fact\n\nBody text about Vulkan.',
  };
}

function createStorage(): StorageIo {
  const files = new Map<string, unknown>();
  return {
    ensureDir: () => undefined,
    readJson: (filePath: string) => (files.has(filePath) ? files.get(filePath) : null),
    writeJsonAtomic: (filePath: string, data: unknown) => {
      files.set(filePath, data);
    },
  } as unknown as StorageIo;
}

function createStack(options: {
  root: string;
}) {
  const index = new KnowledgeIndexService({
    listSpaces: () => [space(options.root)],
    snapshotPath: () => path.join(options.root, 'index.json'),
    storage: createStorage(),
    now: () => new Date('2026-09-01T00:00:00.000Z'),
    readFile: (filePath) => readFile(filePath, 'utf8'),
    statMtime: async () => Date.parse('2026-09-01T00:00:00.000Z'),
  });
  const query = new KnowledgeQueryService({
    listSpaces: () => [space(options.root)],
    index,
    readFile: (filePath) => readFile(filePath, 'utf8'),
    statMtime: async () => Date.parse('2026-09-01T00:00:00.000Z'),
  });
  const write = new KnowledgeWriteService({
    listSpaces: () => [space(options.root)],
    writeFile: async (filePath, contents) => {
      mkdirSync(path.dirname(filePath), { recursive: true });
      writeFileSync(filePath, contents, 'utf8');
    },
    mkdir: async (dirPath) => {
      mkdirSync(dirPath, { recursive: true });
    },
    index,
    now: () => new Date('2026-09-01T00:00:00.000Z'),
  });
  return { index, query, write, compile: new KnowledgeCompileService({ now: () => new Date('2026-09-01T00:00:00.000Z') }) };
}

describe('Knowledge five services', () => {
  it('indexes and queries Identity/Path plus Lexical across the six markdown-first lanes', async () => {
    const root = tempDir();
    mkdirSync(path.join(root, 'facts'), { recursive: true });
    writeFileSync(path.join(root, 'facts', 'sample.md'), serializeKnowledgeCard(draftCard()), 'utf8');
    const { query, compile } = createStack({ root });
    const listed = await query.listCards('user');
    expect(listed).toHaveLength(1);
    expect(listed[0]?.title).toBe('Sample fact');
    const result = await query.query({ text: 'vulkan', lanes: ['Identity/Path', 'Lexical'] });
    expect(result.hits.some((hit) => hit.title === 'Sample fact')).toBe(true);
    expect(result.lanes.map((lane) => lane.lane)).toEqual(['Identity/Path', 'Lexical']);
    const pack = compile.compile(result);
    expect(pack.hits.length).toBeGreaterThan(0);
    expect(pack).not.toHaveProperty('semanticClaimed');
  });

  it('rejects writes without human confirmation even in full-access', async () => {
    const root = tempDir();
    const { write } = createStack({ root });
    await expect(write.write({
      spaceId: 'user',
      card: draftCard(),
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: false } as never,
    })).rejects.toBeInstanceOf(KnowledgeHumanConfirmationRequiredError);
  });

  it('does not auto-promote a confirmed draft write', async () => {
    const root = tempDir();
    const { write } = createStack({ root });
    const saved = await write.write({
      spaceId: 'user',
      card: draftCard(),
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
    });
    expect(saved.lifecycle).toBe('draft');
    await expect(write.promote({
      spaceId: 'user',
      card: saved,
      to: 'verified',
      permissionMode: 'full-access',
      confirmation: { explicitHumanConfirmation: true },
    })).rejects.toBeInstanceOf(KnowledgeLifecycleError);
  });

  it('creates a candidate only with explicit user intent', async () => {
    const candidates = createDisposableCandidateService(tempDir(), {
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      createId: () => 'fixed',
    });
    await expect(candidates.createCandidate({
      sessionId: 's1',
      card: draftCard(),
      explicitUserIntent: false,
    })).rejects.toThrow(/KNOWLEDGE_CANDIDATE_REQUIRES_INTENT/);
    const created = await candidates.createCandidate({
      sessionId: 's1',
      card: draftCard(),
      explicitUserIntent: true,
    });
    expect(created.card.lifecycle).toBe('candidate');
    expect(await candidates.listCandidates('s1')).toHaveLength(1);
  });
});
