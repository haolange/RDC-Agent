import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { investigationMethodCases } from '../testing/fixtures/investigationMethodCases';
import { StorageIo } from '../sessions/store/StorageIo';
import { createDisposableCandidateService } from './KnowledgeCandidateService';
import { KnowledgeCompileService } from './KnowledgeCompileService';
import { KnowledgeIndexService, contentHashOf } from './KnowledgeIndexService';
import { KnowledgeQueryService } from './KnowledgeQueryService';
import { KnowledgeWriteService } from './KnowledgeWriteService';
import { KnowledgeTopicStore } from './KnowledgeTopicStore';
import { KnowledgeHumanConfirmationRequiredError, KnowledgeLifecycleError } from './knowledgeErrors';
import { serializeKnowledgeCard } from './knowledgeCardSchema';
import { projectKnowledgeRead } from './KnowledgeReadService';
import { createKnowledgeTools } from './KnowledgeTools';
import type { KnowledgeCardRecord, KnowledgeSpace } from '@shared/types/knowledge';

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
    readTopics: () => new KnowledgeTopicStore(() => options.root).read(),
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
  it('shows the declared applicability of each hit without reading the card body', async () => {
    const root = tempDir();
    try {
      mkdirSync(path.join(root, 'facts'), { recursive: true });
      const scoped = { ...draftCard('facts/scoped.md'), title: 'Scoped Vulkan fact',
        scope: { api: 'Vulkan', gpuVendor: 'Qualcomm', exclusions: { driver: ['512.0', '615.2'] } } };
      const open = { ...draftCard('facts/open.md'), title: 'Open Vulkan fact', scope: {} };
      for (const card of [scoped, open]) writeFileSync(path.join(root, card.relativePath), serializeKnowledgeCard(card), 'utf8');
      const { query, compile } = createStack({ root });
      const search = createKnowledgeTools('scope-fixture', { query, compile }).find(tool => tool.name === 'knowledge_search')!;
      const result = await search.execute('scope', { query: 'Vulkan' });
      const text = (result.content[0] as { text: string }).text;
      expect(text).toMatch(/Scoped Vulkan fact[^\n]*\n {3}applies to: api=Vulkan, gpuVendor=Qualcomm · excludes: driver=512.0, driver=615.2/u);
      expect(text).toMatch(/Open Vulkan fact[^\n]*\n {3}applies to: not declared/u);
      expect((result.details as { hits: Array<{ cardId: string; scope?: unknown }> }).hits)
        .toEqual(expect.arrayContaining([expect.objectContaining({ cardId: scoped.cardId, scope: scoped.scope }),
          expect.objectContaining({ cardId: open.cardId, scope: undefined })]));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('rejects unknown selected spaces instead of returning misleading empty search results', async () => {
    const root = tempDir();
    try {
      mkdirSync(path.join(root, 'facts'), { recursive: true });
      const card = draftCard();
      writeFileSync(path.join(root, card.relativePath), serializeKnowledgeCard(card), 'utf8');
      const { query, compile } = createStack({ root });
      const search = createKnowledgeTools('space-fixture', { query, compile }).find(tool => tool.name === 'knowledge_search')!;
      await expect(search.execute('invalid', { query: 'Vulkan', spaceIds: ['user', 'user:user'] }))
        .rejects.toThrow('KNOWLEDGE_SPACE_UNKNOWN: ["user:user"]. Use exact space IDs from knowledge_browse: ["user"].');
      const valid = await search.execute('valid', { query: 'Vulkan', spaceIds: ['user'] });
      expect(valid.details).toMatchObject({ count: 1, cardIds: [card.cardId] });
      const unscoped = await search.execute('unscoped', { query: 'Vulkan' });
      expect(unscoped.details).toMatchObject({ count: 1, cardIds: [card.cardId] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires a current version when an Agent expands a card after a search', async () => {
    const root = tempDir();
    try {
      mkdirSync(path.join(root, 'facts'), { recursive: true });
      const relativePath = 'facts/versioned.md';
      const cardPath = path.join(root, relativePath);
      const original = { ...draftCard(relativePath), title: 'Versioned source', body: '# Versioned source\n\n## Evidence\nInitial evidence marker.' };
      writeFileSync(cardPath, serializeKnowledgeCard(original), 'utf8');
      const { query, compile } = createStack({ root });
      const tools = createKnowledgeTools('versioned-fixture', { query, compile });
      const search = tools.find(tool => tool.name === 'knowledge_search')!;
      const read = tools.find(tool => tool.name === 'knowledge_read')!;
      const found = await search.execute('search', { query: 'Initial evidence' });
      const firstHash = (found.details as { hits: Array<{ contentHash: string }> }).hits[0].contentHash;
      writeFileSync(cardPath, serializeKnowledgeCard({ ...original, body: '# Versioned source\n\n## Evidence\nChanged evidence marker.\n\n## Control\nSeparate control marker.' }), 'utf8');

      const unversioned = await read.execute('unversioned', { spaceId: 'user', relativePath });
      expect(unversioned.isError).toBe(true);
      expect(unversioned.content[0]).toMatchObject({ text: expect.stringContaining('KNOWLEDGE_VERSION_REQUIRED') });
      const stale = await read.execute('stale', { spaceId: 'user', relativePath, mode: 'full', contentHash: firstHash });
      expect(stale.isError).toBe(true);
      expect(stale.content[0]).toMatchObject({ text: expect.stringContaining('KNOWLEDGE_VERSION_CHANGED') });
      const summary = await read.execute('summary', { spaceId: 'user', relativePath, mode: 'summary' });
      expect(summary.isError).toBeFalsy();
      const detail = summary.details as { contentHash: string; lineCount: number; headings: Array<{ title: string; line: number; level: number }> };
      const currentHash = detail.contentHash;
      expect(currentHash).not.toBe(firstHash);
      const evidenceHeading = detail.headings.find(heading => heading.title === 'Evidence');
      expect(evidenceHeading).toMatchObject({ level: 2, line: expect.any(Number) });
      expect(detail.lineCount).toBeGreaterThan(evidenceHeading!.line);
      expect(summary.content[0]).toMatchObject({ text: expect.stringContaining(`Evidence (line ${evidenceHeading!.line}, level 2)`) });
      const section = await read.execute('section', { spaceId: 'user', relativePath, mode: 'section',
        heading: 'Evidence', headingLine: evidenceHeading!.line, contentHash: currentHash });
      expect(section.isError).toBeFalsy();
      expect(section.content[0]).toMatchObject({ text: expect.stringContaining('Changed evidence marker.') });
      expect(section.content[0]).not.toMatchObject({ text: expect.stringContaining('Separate control marker.') });
      const current = await read.execute('current', { spaceId: 'user', relativePath, mode: 'full', contentHash: currentHash });
      expect(current.isError).toBeFalsy();
      expect(current.content[0]).toMatchObject({ text: expect.stringContaining('Changed evidence marker.') });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps competing synthetic cases and applicability available for versioned reading', async () => {
    const root = tempDir();
    try {
      mkdirSync(path.join(root, 'cases'), { recursive: true });
      for (const entry of investigationMethodCases) {
        const relativePath = `cases/${entry.id}.md`;
        writeFileSync(path.join(root, relativePath), serializeKnowledgeCard({
          cardId: `user:${relativePath}`, spaceId: 'user', relativePath, type: 'case', lifecycle: 'draft',
          title: entry.id, scope: { platform: entry.platform }, relations: [], body: entry.body,
        }), 'utf8');
      }
      const { query } = createStack({ root });
      const similar = await query.query({ text: 'washedout', scope: { platform: 'FixtureA' } });
      expect(similar.hits.map(hit => hit.title).sort()).toEqual(['input-radiance', 'output-transfer']);
      const differentSymptom = await query.query({ text: 'transfercurve', scope: { platform: 'FixtureA' } });
      expect(differentSymptom.hits.map(hit => hit.title).sort()).toEqual(['output-transfer', 'ring-transfer']);
      expect((await query.query({ text: 'washedout' })).hits.map(hit => hit.title)).toContain('other-platform');
      expect((await query.query({ text: 'fixture-no-such-mechanism' })).hits).toHaveLength(0);
      for (const hit of similar.hits) {
        const card = await query.getCard(hit.spaceId, hit.relativePath);
        if (!card) throw new Error(`Fixture card missing: ${hit.cardId}`);
        const source = projectKnowledgeRead(card, { spaceId: hit.spaceId, relativePath: hit.relativePath,
          mode: 'full', contentHash: hit.contentHash });
        const expected = investigationMethodCases.find(entry => entry.id === hit.title)!;
        expect(source.card.contentHash).toBe(hit.contentHash);
        expect(source.content).toContain(expected.body);
        expect(source.content).toContain('## Applicability');
        expect(source.content).toContain('## Counterevidence');
        expect(source.content).toContain('## Stop and recheck');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires text evidence, honors relation kinds, and binds pages and packs to source versions', async () => {
    const root = tempDir();
    mkdirSync(path.join(root, 'facts'), { recursive: true });
    const first = { ...draftCard('facts/a.md'), title: 'Texture sampling', body: '纹理采样和 texture sampling', relations: [{ kind: 'supports' as const, targetCardId: 'user:shared' }] };
    const second = { ...draftCard('facts/b.md'), title: 'Mesh index', body: 'mesh index', relations: [{ kind: 'supports' as const, targetCardId: 'user:shared' }] };
    const firstPath = path.join(root, 'facts', 'a.md');
    writeFileSync(firstPath, serializeKnowledgeCard(first), 'utf8');
    writeFileSync(path.join(root, 'facts', 'b.md'), serializeKnowledgeCard(second), 'utf8');
    const { query, compile } = createStack({ root });
    expect((await query.query({ text: 'zzzz_absent_mechanism_91827' })).hits).toHaveLength(0);
    expect((await query.query({ text: 'sampling texture' })).hits.map(hit => hit.cardId)).toEqual([first.cardId]);
    expect((await query.query({ text: '纹理 采样' })).hits.map(hit => hit.cardId)).toEqual([first.cardId]);
    expect((await query.query({ text: '采样 ＴＥＸＴＵＲＥ' })).hits.map(hit => hit.cardId)).toEqual([first.cardId]);
    const related = await query.query({ relationTargetCardId: 'user:shared', lanes: ['Relation/Graph'] });
    expect(related.hits).toHaveLength(2);
    expect(compile.compile(related).conflicts).toEqual([]);
    const page = await query.query({ limit: 1 });
    expect(page.nextOffset).toBe(1);
    expect((await query.query({ offset: 1, limit: 1, expectedRevision: page.revision })).hits).toHaveLength(1);
    await expect(query.query({ offset: 1, limit: 1 })).rejects.toThrow('KNOWLEDGE_REVISION_REQUIRED');
    writeFileSync(firstPath, serializeKnowledgeCard({ ...first, relations: [{ kind: 'contradicts', targetCardId: second.cardId }] }), 'utf8');
    await expect(query.query({ offset: 1, limit: 1, expectedRevision: page.revision })).rejects.toThrow('KNOWLEDGE_INDEX_CHANGED');
    const changed = await query.query();
    expect(compile.compile(changed).conflicts).toEqual([{ leftCardId: first.cardId, rightCardId: second.cardId, kind: 'contradicts' }]);
    expect(compile.compile(changed).packId).not.toBe(compile.compile(page).packId);
  });

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

  it('keeps retired cards available for audit without returning them in default retrieval', async () => {
    const root = tempDir();
    mkdirSync(path.join(root, 'facts'), { recursive: true });
    const card = { ...draftCard(), lifecycle: 'retired' as const };
    writeFileSync(path.join(root, 'facts', 'sample.md'), serializeKnowledgeCard(card), 'utf8');
    const { query } = createStack({ root });
    expect((await query.listCards('user'))[0]?.lifecycle).toBe('retired');
    expect((await query.query({ text: 'vulkan', lanes: ['Lexical'] })).hits).toHaveLength(0);
    expect((await query.query({ text: 'vulkan', lifecycle: ['retired'], lanes: ['Lexical'] })).hits)
      .toHaveLength(1);
  });

  it('projects list-row preview/updatedAt into hits and ingest provenance into card detail', async () => {
    const root = tempDir();
    mkdirSync(path.join(root, 'facts'), { recursive: true });
    const card = draftCard();
    card.sourceHash = 'a'.repeat(64);
    card.sourceMtimeMs = 1_700_000_000_000;
    card.sourceSize = 128;
    const source = serializeKnowledgeCard(card);
    writeFileSync(path.join(root, 'facts', 'sample.md'), source, 'utf8');
    const { query } = createStack({ root });
    const result = await query.query({ text: 'vulkan', lanes: ['Lexical'] });
    const hit = result.hits.find((entry) => entry.title === 'Sample fact');
    expect(hit?.preview).toContain('Body text about Vulkan');
    expect(hit?.updatedAt).toBe(Date.parse('2026-09-01T00:00:00.000Z'));
    expect(hit?.contentHash).toBe(contentHashOf(source));
    const detail = await query.getCard('user', 'facts/sample.md');
    expect(detail?.contentHash).toBe(hit?.contentHash);
    expect(detail?.content).toBe(source);
    expect(detail?.body).toBe(card.body);
    expect(detail?.sourceHash).toBe('a'.repeat(64));
    expect(detail?.sourceMtimeMs).toBe(1_700_000_000_000);
    expect(detail?.sourceSize).toBe(128);
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

  it('keeps a card with a missing declared image out of Candidate and Verified', async () => {
    const root = tempDir();
    const candidates = createDisposableCandidateService(tempDir(), {
      listSpaces: () => [space(root)],
    });
    const { write } = createStack({ root });
    const card: KnowledgeCardRecord = {
      ...draftCard('facts/missing-image.md'),
      images: [{ relativePath: 'facts/observed.png', role: 'observed' }],
    };
    await expect(candidates.createCandidate({
      sessionId: 's1', card, explicitUserIntent: true,
    })).rejects.toMatchObject({ code: 'KNOWLEDGE_ASSETS_MISSING' });
    expect(await candidates.listCandidates('s1')).toHaveLength(0);
    await expect(write.write({
      spaceId: 'user', card: { ...card, lifecycle: 'verified' },
      permissionMode: 'default', confirmation: { explicitHumanConfirmation: true },
    })).rejects.toMatchObject({ code: 'KNOWLEDGE_ASSETS_MISSING' });

    mkdirSync(path.join(root, 'facts'), { recursive: true });
    writeFileSync(path.join(root, 'facts', 'observed.png'), Buffer.from('qa-image'));
    const candidate = await candidates.createCandidate({
      sessionId: 's1', card, explicitUserIntent: true,
    });
    expect(candidate.card.lifecycle).toBe('candidate');
  });

  it('keeps an incomplete non-image attachment declaration in Draft', async () => {
    const root = tempDir();
    const candidates = createDisposableCandidateService(tempDir(), { listSpaces: () => [space(root)] });
    const { write, query } = createStack({ root });
    const card: KnowledgeCardRecord = { ...draftCard('facts/missing-attachment.md'), missingAssets: ['asset-12345678'] };
    await write.write({
      spaceId: 'user', card, permissionMode: 'default',
      confirmation: { explicitHumanConfirmation: true },
    });
    const persisted = await query.getCard('user', 'facts/missing-attachment.md');
    expect(persisted?.missingAssets).toEqual(['asset-12345678']);
    await expect(candidates.createCandidate({
      sessionId: 's1', card: { ...card, missingAssets: persisted?.missingAssets }, explicitUserIntent: true,
    })).rejects.toMatchObject({ code: 'KNOWLEDGE_ASSETS_MISSING' });
    expect(await candidates.listCandidates('s1')).toHaveLength(0);
    await expect(write.write({
      spaceId: 'user', card: { ...card, lifecycle: 'verified' }, permissionMode: 'default',
      confirmation: { explicitHumanConfirmation: true },
    })).rejects.toMatchObject({ code: 'KNOWLEDGE_ASSETS_MISSING' });
  });
});
