import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { KNOWLEDGE_CARD_TYPES, KNOWLEDGE_LIFECYCLES, type KnowledgeSpace, type KnowledgeTopicChanges } from '@shared/types/knowledge';
import { StorageIo } from '../sessions/store/StorageIo';
import { KnowledgeIndexService } from './KnowledgeIndexService';
import { KnowledgeQueryService } from './KnowledgeQueryService';
import { KnowledgeTopicService } from './KnowledgeTopicService';
import { KnowledgeTopicStore } from './KnowledgeTopicStore';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'knowledge-topics-'));
  roots.push(root);
  const cardPath = path.join(root, 'material.md');
  const original = '---\ntitle: 纹理采样\n---\n# 纹理采样\n\nFirst observation.\n';
  await writeFile(cardPath, original, 'utf8');
  const space: KnowledgeSpace = { spaceId: 'user', kind: 'user', label: 'User', rootPath: root };
  const snapshots = new Map<string, unknown>();
  const storage = {
    ensureDir: () => undefined,
    readJson: (key: string) => snapshots.get(key) ?? null,
    writeJsonAtomic: (key: string, value: unknown) => { snapshots.set(key, value); },
  } as unknown as StorageIo;
  const index = new KnowledgeIndexService({ listSpaces: () => [space], snapshotPath: () => path.join(root, 'index.json'), storage,
    now: () => new Date(0), readFile: file => readFile(file, 'utf8'), statMtime: async () => 1 });
  const store = new KnowledgeTopicStore(() => root);
  const topics = new KnowledgeTopicService(store, index);
  const query = new KnowledgeQueryService({ listSpaces: () => [space], index, readFile: file => readFile(file, 'utf8'),
    statMtime: async () => 1, readTopics: () => store.read() });
  return { root, cardPath, original, topics, query, store };
}

it('keeps unclassified Markdown browsable when all types and lifecycles are selected', async () => {
  const { root, query } = await fixture();
  await writeFile(path.join(root, 'plain.md'), 'Unclassified source without headings.');
  const all = { type: [...KNOWLEDGE_CARD_TYPES], lifecycle: [...KNOWLEDGE_LIFECYCLES] };
  expect((await query.query(all)).hits.map(hit => hit.title)).toEqual(expect.arrayContaining(['纹理采样', 'plain']));
  expect((await query.query({ ...all, text: '纹理' })).hits.map(hit => hit.title)).toEqual(['纹理采样']);
  expect((await query.query({ ...all, type: ['fact'] })).hits).toHaveLength(0);
  expect((await query.query({ ...all, lifecycle: ['draft'] })).hits).toHaveLength(0);
});

it('proposes and previews without changing knowledge, then atomically applies only confirmed versioned assignments', async () => {
  const { root, cardPath, original, topics, query, store } = await fixture();
  const proposal = await topics.suggest();
  expect(proposal.suggestions.find(item => item.topic.id === 'texture')?.cards).toHaveLength(1);
  await expect(readFile(path.join(root, '.topics.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  const page = await query.query({ limit: 1 });
  const card = proposal.suggestions.find(item => item.topic.id === 'texture')!.cards[0];
  const changes: KnowledgeTopicChanges = {
    expectedRevision: proposal.revision, expectedCorpusRevision: proposal.corpusRevision,
    topics: [{ id: 'gloss-drift', label: 'Gloss drift', synonyms: ['glosschange'] }],
    assignments: [{ cardId: card.cardId, contentHash: card.contentHash, topicIds: ['gloss-drift'] }],
  };
  const preview = await topics.preview(changes);
  expect(preview.cards[0]).toMatchObject({ before: [], after: ['gloss-drift'], stale: false });
  await expect(topics.apply(changes, 'wrong')).rejects.toThrow('PREVIEW_CHANGED');
  await expect(readFile(path.join(root, '.topics.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  await topics.apply(changes, preview.changeHash);
  expect(await readFile(cardPath, 'utf8')).toBe(original);
  expect((await query.query({ text: 'glosschange' })).hits[0]?.topics?.[0].id).toBe('gloss-drift');
  expect((await query.getCard('user', 'material.md'))?.topics?.[0].id).toBe('gloss-drift');
  await expect(query.query({ offset: 1, limit: 1, expectedRevision: page.revision })).rejects.toThrow('INDEX_CHANGED');
  await expect(topics.apply(changes, preview.changeHash)).rejects.toThrow('TOPICS_CHANGED');
  await writeFile(cardPath, original.replace('First observation.', 'Changed observation.'), 'utf8');
  expect((await query.query({ text: 'glosschange' })).hits).toHaveLength(0);
  expect((await query.getCard('user', 'material.md'))?.topics).toBeUndefined();
  expect((await store.read()).document.assignments).toHaveLength(1);
});

it('rejects stale source versions and preserves an invalid taxonomy instead of overwriting it', async () => {
  const { root, cardPath, topics, store } = await fixture();
  const proposal = await topics.suggest();
  const suggestion = proposal.suggestions.find(item => item.topic.id === 'texture')!;
  const card = suggestion.cards[0];
  const changes: KnowledgeTopicChanges = { expectedRevision: proposal.revision, expectedCorpusRevision: proposal.corpusRevision,
    topics: [suggestion.topic], assignments: [{ cardId: card.cardId, contentHash: card.contentHash, topicIds: [suggestion.topic.id] }] };
  await writeFile(cardPath, 'changed source', 'utf8');
  await expect(topics.preview(changes)).rejects.toThrow('INDEX_CHANGED');
  const malformed = '{"schemaVersion":999,"important":"retain"}';
  await writeFile(path.join(root, '.topics.json'), malformed, 'utf8');
  await expect(store.read()).rejects.toThrow();
  expect(await readFile(path.join(root, '.topics.json'), 'utf8')).toBe(malformed);
});

it('previews a topic merge, transfers its assignments and synonyms, and rejects merge chains', async () => {
  const { topics, store } = await fixture();
  const proposal = await topics.suggest();
  const card = proposal.suggestions.find(item => item.topic.id === 'texture')!.cards[0];
  const initial: KnowledgeTopicChanges = { expectedRevision: proposal.revision, expectedCorpusRevision: proposal.corpusRevision,
    topics: [{ id: 'source', label: 'Surface', synonyms: ['表面'] }, { id: 'target', label: 'Material', synonyms: ['材质'] }],
    assignments: [{ cardId: card.cardId, contentHash: card.contentHash, topicIds: ['source'] }] };
  const first = await topics.preview(initial);
  await topics.apply(initial, first.changeHash);
  const latest = await topics.suggest();
  const merge: KnowledgeTopicChanges = { expectedRevision: latest.revision, expectedCorpusRevision: latest.corpusRevision,
    topics: [], assignments: [], merges: [{ sourceId: 'source', targetId: 'target' }] };
  const preview = await topics.preview(merge);
  expect(preview.merges[0]).toMatchObject({ source: { id: 'source' }, target: { id: 'target', synonyms: expect.arrayContaining(['Surface', '表面', '材质']) } });
  expect(preview.cards[0]).toMatchObject({ before: ['source'], after: ['target'] });
  await expect(topics.preview({ ...merge, merges: [...merge.merges!, { sourceId: 'target', targetId: 'source' }] })).rejects.toThrow('MERGE_INVALID');
  await topics.apply(merge, preview.changeHash);
  expect((await store.read()).document).toMatchObject({ topics: [{ id: 'target' }], assignments: [{ topicIds: ['target'] }] });
});
