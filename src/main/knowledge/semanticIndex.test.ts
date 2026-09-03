import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { EmbeddingCatalog, EmbeddingSettings } from '@shared/types/embedding';
import { StorageIo } from '../sessions/StorageIo';
import { EmbeddingExecutionService } from '../settings/EmbeddingExecutionService';
import { serializeKnowledgeCard } from './knowledgeCardSchema';
import { KnowledgeIndexService } from './KnowledgeIndexService';
import { KnowledgeQueryService } from './KnowledgeQueryService';

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '__fixtures__/colddata/hair-adreno-sanitized.yaml',
);

const catalog: EmbeddingCatalog = {
  schemaVersion: 1,
  catalogRevision: 'rev-fixture',
  models: [{
    providerId: 'openai',
    modelId: 'test-embed-8',
    label: 'test-embed-8',
    dimensions: 8,
    protocol: 'OpenAICompatibleEmbeddings',
    adapterId: 'openai-compatible-embeddings',
    baseUrl: 'https://api.openai.com/v1',
    factSourceId: 'rdc-agent:openai:0',
  }],
};

const settings: EmbeddingSettings = {
  providerId: 'openai',
  modelId: 'test-embed-8',
  allowKnowledgeUpload: true,
};

function tokenVector(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = text.toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  for (const token of tokens) {
    const digest = createHash('sha256').update(token, 'utf8').digest();
    vector[digest.readUInt32BE(0) % dimensions] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

describe('semantic vector index', () => {
  it('rebuilds sanitized fixture cards into a durable index that query can hit twice', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdc-semantic-fix-'));
    mkdirSync(path.join(root, 'cases'), { recursive: true });
    const yaml = readFileSync(fixturePath, 'utf8');
    writeFileSync(path.join(root, 'cases', 'hair-adreno.md'), serializeKnowledgeCard({
      cardId: 'user:cases/hair-adreno.md',
      spaceId: 'user',
      relativePath: 'cases/hair-adreno.md',
      type: 'case',
      lifecycle: 'draft',
      title: 'Adreno 740 hair darkening',
      scope: { platform: 'Android', api: 'Vulkan', gpuArch: 'Adreno' },
      relations: [],
      body: yaml,
      sourceStatus: 'fixed',
      caseId: 'fixture-hair-adreno-740',
    }), 'utf8');

    const indexStorage = new StorageIo();
    const index = new KnowledgeIndexService({
      listSpaces: () => [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: root }],
      snapshotPath: () => path.join(root, 'knowledge-index.json'),
      storage: indexStorage,
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      readFile: (filePath) => readFile(filePath, 'utf8'),
      statMtime: async () => Date.parse('2026-09-01T00:00:00.000Z'),
    });
    const knowledgeSnapshot = await index.rebuild();
    const embeddingStorage = new StorageIo();
    const snapshotPath = path.join(root, 'semantic-index.json');
    const embedding = new EmbeddingExecutionService({
      getCatalog: () => catalog,
      getSettings: () => settings,
      isProviderConfigured: () => true,
      snapshotPath: () => snapshotPath,
      storage: embeddingStorage,
      freeze: async () => ({ handle: 'lease-embed' }),
      release: () => undefined,
      readLease: () => ({ provider: { apiKey: 'sk-test' }, connectionHeaders: {} }),
      fetch: (async () => { throw new Error('real OpenAI is T18'); }) as unknown as typeof fetch,
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      batchSize: 8,
      interBatchDelayMs: 0,
      sleep: async () => undefined,
      listCorpusDocuments: () => index.listCorpusDocuments(),
      getCorpusHash: () => index.computeLiveRevision(),
      embedTexts: async ({ texts, model }) => ({
        modelId: model.modelId,
        dimensions: model.dimensions,
        vectors: texts.map((text, rowIndex) => ({
          index: rowIndex,
          embedding: tokenVector(text, model.dimensions),
        })),
      }),
    });

    const ready = await embedding.rebuildSemanticIndex();
    expect(ready.availability).toBe('ready');
    expect(ready.snapshot?.chunkCount).toBeGreaterThan(0);
    expect(ready.snapshot?.vectors).toHaveLength(ready.snapshot?.chunkCount ?? 0);
    expect(ready.snapshot?.corpusHash).toBe(knowledgeSnapshot.revision);
    expect(ready.snapshot?.chunks[0]?.cardId).toBe('user:cases/hair-adreno.md');

    const query = new KnowledgeQueryService({
      listSpaces: () => [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: root }],
      resolveSemanticLaneStatus: () => embedding.resolveSemanticLaneStatus(),
      searchSemantic: (text) => embedding.searchSemantic(text),
      index,
      readFile: (filePath) => readFile(filePath, 'utf8'),
      statMtime: async () => Date.parse('2026-09-01T00:00:00.000Z'),
    });
    const first = await query.query({ text: 'KajiyaDiffuse hair darkened', lanes: ['Semantic'] });
    expect(first.semantic?.availability).toBe('ready');
    const semanticHit = first.lanes.find((lane) => lane.lane === 'Semantic')?.hits[0];
    expect(semanticHit).toMatchObject({
      cardId: 'user:cases/hair-adreno.md',
      relativePath: 'cases/hair-adreno.md',
    });
    expect(semanticHit?.chunkIndex).toEqual(expect.any(Number));
    expect(first.hits[0]?.cardId).toBe('user:cases/hair-adreno.md');

    const restarted = new EmbeddingExecutionService({
      getCatalog: () => catalog,
      getSettings: () => settings,
      isProviderConfigured: () => true,
      snapshotPath: () => snapshotPath,
      storage: new StorageIo(),
      freeze: async () => ({ handle: 'lease-embed' }),
      release: () => undefined,
      readLease: () => ({ provider: { apiKey: 'sk-test' }, connectionHeaders: {} }),
      fetch: (async () => { throw new Error('real OpenAI is T18'); }) as unknown as typeof fetch,
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      batchSize: 8,
      interBatchDelayMs: 0,
      sleep: async () => undefined,
      listCorpusDocuments: () => index.listCorpusDocuments(),
      getCorpusHash: () => index.computeLiveRevision(),
      embedTexts: async ({ texts, model }) => ({
        modelId: model.modelId,
        dimensions: model.dimensions,
        vectors: texts.map((text, rowIndex) => ({
          index: rowIndex,
          embedding: tokenVector(text, model.dimensions),
        })),
      }),
    });
    expect((await restarted.resolveSemanticLaneStatus()).availability).toBe('ready');
    const second = await new KnowledgeQueryService({
      listSpaces: () => [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: root }],
      resolveSemanticLaneStatus: () => restarted.resolveSemanticLaneStatus(),
      searchSemantic: (text) => restarted.searchSemantic(text),
      index,
      readFile: (filePath) => readFile(filePath, 'utf8'),
      statMtime: async () => Date.parse('2026-09-01T00:00:00.000Z'),
    }).query({ text: 'KajiyaDiffuse hair darkened', lanes: ['Semantic'] });
    expect(second.lanes.find((lane) => lane.lane === 'Semantic')?.hits).toEqual(
      first.lanes.find((lane) => lane.lane === 'Semantic')?.hits,
    );
  });

  it('goes stale and returns no semantic hits after a new card is added without rebuild', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdc-semantic-add-'));
    mkdirSync(path.join(root, 'cases'), { recursive: true });
    writeFileSync(path.join(root, 'cases', 'hair-adreno.md'), serializeKnowledgeCard({
      cardId: 'user:cases/hair-adreno.md',
      spaceId: 'user',
      relativePath: 'cases/hair-adreno.md',
      type: 'case',
      lifecycle: 'draft',
      title: 'Adreno 740 hair darkening',
      scope: { platform: 'Android', api: 'Vulkan' },
      relations: [],
      body: readFileSync(fixturePath, 'utf8'),
    }), 'utf8');
    const index = new KnowledgeIndexService({
      listSpaces: () => [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: root }],
      snapshotPath: () => path.join(root, 'knowledge-index.json'),
      storage: new StorageIo(),
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      readFile: (filePath) => readFile(filePath, 'utf8'),
      statMtime: async () => Date.parse('2026-09-01T00:00:00.000Z'),
    });
    const embedding = new EmbeddingExecutionService({
      getCatalog: () => catalog,
      getSettings: () => settings,
      isProviderConfigured: () => true,
      snapshotPath: () => path.join(root, 'semantic-index.json'),
      storage: new StorageIo(),
      freeze: async () => ({ handle: 'lease-embed' }),
      release: () => undefined,
      readLease: () => ({ provider: { apiKey: 'sk-test' }, connectionHeaders: {} }),
      fetch: (async () => { throw new Error('real OpenAI is T18'); }) as unknown as typeof fetch,
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      batchSize: 8,
      interBatchDelayMs: 0,
      sleep: async () => undefined,
      listCorpusDocuments: () => index.listCorpusDocuments(),
      getCorpusHash: () => index.computeLiveRevision(),
      embedTexts: async ({ texts, model }) => ({
        modelId: model.modelId,
        dimensions: model.dimensions,
        vectors: texts.map((text, rowIndex) => ({
          index: rowIndex,
          embedding: tokenVector(text, model.dimensions),
        })),
      }),
    });
    expect((await embedding.rebuildSemanticIndex()).availability).toBe('ready');

    writeFileSync(path.join(root, 'cases', 'new-card.md'), serializeKnowledgeCard({
      cardId: 'user:cases/new-card.md',
      spaceId: 'user',
      relativePath: 'cases/new-card.md',
      type: 'fact',
      lifecycle: 'draft',
      title: 'New card',
      scope: {},
      relations: [],
      body: 'A newly added knowledge card.',
    }), 'utf8');

    expect(await embedding.resolveSemanticLaneStatus()).toMatchObject({
      availability: 'stale',
      reason: 'corpus-hash-mismatch',
    });
    expect(await embedding.searchSemantic('KajiyaDiffuse hair darkened')).toEqual([]);
    const query = await new KnowledgeQueryService({
      listSpaces: () => [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: root }],
      resolveSemanticLaneStatus: () => embedding.resolveSemanticLaneStatus(),
      searchSemantic: (text) => embedding.searchSemantic(text),
      index,
      readFile: (filePath) => readFile(filePath, 'utf8'),
      statMtime: async () => Date.parse('2026-09-01T00:00:00.000Z'),
    }).query({ text: 'KajiyaDiffuse hair darkened', lanes: ['Semantic'] });
    expect(query.semantic?.availability).toBe('stale');
    expect(query.lanes.find((lane) => lane.lane === 'Semantic')?.hits).toEqual([]);
  });

  it('keeps Semantic hits empty when the lane is not ready', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdc-semantic-closed-'));
    const index = new KnowledgeIndexService({
      listSpaces: () => [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: root }],
      snapshotPath: () => path.join(root, 'knowledge-index.json'),
      storage: new StorageIo(),
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      readFile: (filePath) => readFile(filePath, 'utf8'),
      statMtime: async () => Date.parse('2026-09-01T00:00:00.000Z'),
    });
    const query = new KnowledgeQueryService({
      listSpaces: () => [{ spaceId: 'user', kind: 'user', label: 'User', rootPath: root }],
      resolveSemanticLaneStatus: () => ({
        availability: 'unavailable',
        reason: 'consent-denied',
        selectedIdentity: null,
        selectedDimensions: null,
        snapshot: null,
      }),
      index,
      readFile: (filePath) => readFile(filePath, 'utf8'),
      statMtime: async () => Date.parse('2026-09-01T00:00:00.000Z'),
    });
    const result = await query.query({ text: 'hair', lanes: ['Semantic'] });
    expect(result.semantic?.availability).toBe('unavailable');
    expect(result.lanes.find((lane) => lane.lane === 'Semantic')?.hits).toEqual([]);
  });
});
