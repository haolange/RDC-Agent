import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  EmbeddingConsentDeniedError,
  EmbeddingExecutionService,
  EmbeddingIndexValidationError,
  EmbeddingUnconfiguredError,
} from './EmbeddingExecutionService';
import type { EmbeddingCatalog, EmbeddingSettings, SemanticIndexSnapshot } from '@shared/types/embedding';
import { knowledgeCorpusHash, type SemanticCorpusDocument } from '../knowledge/knowledgeLanes';
import { StorageIo } from '../sessions/StorageIo';

const catalog: EmbeddingCatalog = {
  schemaVersion: 1,
  catalogRevision: 'rev-1',
  models: [
    {
      providerId: 'openai',
      modelId: 'text-embedding-3-small',
      label: 'text-embedding-3-small',
      dimensions: 1536,
      protocol: 'OpenAICompatibleEmbeddings',
      adapterId: 'openai-compatible-embeddings',
      baseUrl: 'https://api.openai.com/v1',
      factSourceId: 'rdc-agent:openai:0',
    },
    {
      providerId: 'openai',
      modelId: 'test-embed-8',
      label: 'test-embed-8',
      dimensions: 8,
      protocol: 'OpenAICompatibleEmbeddings',
      adapterId: 'openai-compatible-embeddings',
      baseUrl: 'https://api.openai.com/v1',
      factSourceId: 'rdc-agent:openai:0',
    },
  ],
};

const fixtureDoc: SemanticCorpusDocument = {
  cardId: 'user:cases/hair-adreno.md',
  spaceId: 'user',
  relativePath: 'cases/hair-adreno.md',
  title: 'Adreno 740 hair darkening',
  type: 'case',
  lifecycle: 'draft',
  body: 'Hair darkened on Adreno 740 because KajiyaDiffuse energy folded.',
  contentHash: 'abc123',
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

function mockEmbed(texts: string[], dimensions: number) {
  return {
    modelId: 'test-embed-8',
    dimensions,
    vectors: texts.map((text, index) => ({
      index,
      embedding: tokenVector(text, dimensions),
    })),
  };
}

function createMemoryStorage(): StorageIo {
  const files = new Map<string, unknown>();
  return {
    ensureDir: vi.fn(),
    readJson: (filePath: string) => (files.has(filePath) ? files.get(filePath) : null),
    writeJsonAtomic: (filePath: string, data: unknown) => {
      files.set(filePath, data);
    },
    writeUtf8Atomic: (filePath: string, content: string) => {
      files.set(filePath, JSON.parse(content));
    },
  } as unknown as StorageIo;
}

function selectedSettings(): EmbeddingSettings {
  return {
    providerId: 'openai',
    modelId: 'test-embed-8',
    allowKnowledgeUpload: true,
  };
}

function createService(options: {
  settings?: EmbeddingSettings;
  configured?: boolean;
  fetch?: typeof fetch;
  storage?: StorageIo;
  snapshotPath?: string;
  documents?: SemanticCorpusDocument[];
  catalogRevision?: string;
  embedTexts?: EmbeddingExecutionService['embed'] extends never ? never : (
    input: { texts: string[] }
  ) => Promise<ReturnType<typeof mockEmbed>>;
} = {}): EmbeddingExecutionService {
  const storage = options.storage ?? createMemoryStorage();
  const documents = options.documents ?? [fixtureDoc];
  const catalogRevision = options.catalogRevision;
  return new EmbeddingExecutionService({
    getCatalog: () => (catalogRevision ? { ...catalog, catalogRevision } : catalog),
    getSettings: () => options.settings ?? {
      providerId: null,
      modelId: null,
      allowKnowledgeUpload: false,
    },
    isProviderConfigured: () => options.configured !== false,
    snapshotPath: () => options.snapshotPath ?? '/tmp/semantic-index.json',
    storage,
    freeze: async () => ({ handle: 'lease-embed' }),
    release: vi.fn(),
    readLease: () => ({
      provider: { apiKey: 'sk-test' },
      connectionHeaders: {},
    }),
    fetch: options.fetch ?? vi.fn(),
    now: () => new Date('2026-09-01T00:00:00.000Z'),
    batchSize: 2,
    interBatchDelayMs: 0,
    sleep: async () => undefined,
    listCorpusDocuments: async () => documents,
    getCorpusHash: async () => knowledgeCorpusHash(documents),
    embedTexts: options.embedTexts ?? (async ({ texts, model }) => mockEmbed(texts, model.dimensions)),
  });
}

describe('EmbeddingExecutionService', () => {
  it('returns unavailable when embedding is unconfigured', async () => {
    const status = await createService({}).resolveSemanticLaneStatus();
    expect(status.availability).toBe('unavailable');
    expect(status.reason).toBe('unconfigured');
  });

  it('returns unavailable and never uploads when consent is off, including full-access callers', async () => {
    const embedTexts = vi.fn();
    const service = createService({
      settings: {
        providerId: 'openai',
        modelId: 'test-embed-8',
        allowKnowledgeUpload: false,
      },
      embedTexts,
    });
    const status = await service.resolveSemanticLaneStatus();
    expect(status.availability).toBe('unavailable');
    expect(status.reason).toBe('consent-denied');
    await expect(service.embed(['secret knowledge'])).rejects.toBeInstanceOf(EmbeddingConsentDeniedError);
    await expect(service.rebuildSemanticIndex()).rejects.toBeInstanceOf(EmbeddingConsentDeniedError);
    expect(embedTexts).not.toHaveBeenCalled();
  });

  it('rebuilds a real vector index and goes stale after model, catalog, or corpus change', async () => {
    const storage = createMemoryStorage();
    const service = createService({ settings: selectedSettings(), storage });
    expect(await service.resolveSemanticLaneStatus()).toMatchObject({
      availability: 'stale',
      reason: 'missing-snapshot',
    });

    const ready = await service.rebuildSemanticIndex();
    expect(ready.availability).toBe('ready');
    expect(ready.snapshot).toMatchObject({
      identity: 'openai:test-embed-8',
      dimensions: 8,
      chunker: 'plain-v1',
      corpusHash: knowledgeCorpusHash([fixtureDoc]),
      chunkCount: 1,
    });
    expect(ready.snapshot?.vectors).toHaveLength(1);
    expect(ready.snapshot?.vectors[0]).toHaveLength(8);
    expect(ready.snapshot?.chunks[0]).toMatchObject({
      cardId: fixtureDoc.cardId,
      relativePath: fixtureDoc.relativePath,
      chunkIndex: 0,
    });

    storage.writeJsonAtomic('/tmp/semantic-index.json', {
      ...(ready.snapshot as SemanticIndexSnapshot),
      identity: 'openai:text-embedding-3-small',
    });
    expect(await service.resolveSemanticLaneStatus()).toMatchObject({
      availability: 'stale',
      reason: 'identity-mismatch',
    });

    const switched = createService({
      settings: {
        providerId: 'openai',
        modelId: 'text-embedding-3-small',
        allowKnowledgeUpload: true,
      },
      storage,
    });
    storage.writeJsonAtomic('/tmp/semantic-index.json', ready.snapshot);
    expect(await switched.resolveSemanticLaneStatus()).toMatchObject({
      availability: 'stale',
      reason: 'identity-mismatch',
    });
    expect(await switched.searchSemantic('KajiyaDiffuse')).toEqual([]);

    storage.writeJsonAtomic('/tmp/semantic-index.json', {
      ...(ready.snapshot as SemanticIndexSnapshot),
      identity: 'openai:test-embed-8',
      dimensions: 3072,
    });
    expect(await service.resolveSemanticLaneStatus()).toMatchObject({
      availability: 'stale',
      reason: 'dimension-mismatch',
    });

    const catalogShift = createService({
      settings: selectedSettings(),
      storage,
      catalogRevision: 'rev-2',
    });
    storage.writeJsonAtomic('/tmp/semantic-index.json', ready.snapshot);
    expect(await catalogShift.resolveSemanticLaneStatus()).toMatchObject({
      availability: 'stale',
      reason: 'catalog-revision-mismatch',
    });
  });

  it('never marks metadata-only, missing, corrupt, or partial vectors as ready', async () => {
    const storage = createMemoryStorage();
    const service = createService({ settings: selectedSettings(), storage });
    const ready = await service.rebuildSemanticIndex();
    const snapshot = ready.snapshot as SemanticIndexSnapshot;

    storage.writeJsonAtomic('/tmp/semantic-index.json', {
      schemaVersion: 2,
      identity: snapshot.identity,
      dimensions: snapshot.dimensions,
      chunker: snapshot.chunker,
      corpusHash: snapshot.corpusHash,
      catalogRevision: snapshot.catalogRevision,
      builtAt: snapshot.builtAt,
    });
    expect(await service.resolveSemanticLaneStatus()).toMatchObject({
      availability: 'stale',
      reason: 'invalid-vectors',
    });

    storage.writeJsonAtomic('/tmp/semantic-index.json', {
      ...snapshot,
      vectors: [],
      chunkCount: 1,
    });
    expect(await service.resolveSemanticLaneStatus()).toMatchObject({
      availability: 'stale',
      reason: 'incomplete-vectors',
    });

    storage.writeJsonAtomic('/tmp/semantic-index.json', {
      ...snapshot,
      vectors: [snapshot.vectors[0]?.slice(0, 3)],
    });
    expect(await service.resolveSemanticLaneStatus()).toMatchObject({
      availability: 'stale',
      reason: 'dimension-mismatch',
    });

    storage.writeJsonAtomic('/tmp/semantic-index.json', { not: 'an-index' });
    expect(await service.resolveSemanticLaneStatus()).toMatchObject({
      availability: 'stale',
      reason: 'invalid-vectors',
    });

    const empty = createMemoryStorage();
    const failing = createService({
      settings: selectedSettings(),
      storage: empty,
      embedTexts: async ({ texts }) => ({
        modelId: 'test-embed-8',
        dimensions: 8,
        vectors: texts.slice(0, Math.max(0, texts.length - 1)).map((text, index) => ({
          index,
          embedding: tokenVector(text, 8),
        })),
      }),
    });
    await expect(failing.rebuildSemanticIndex()).rejects.toBeInstanceOf(EmbeddingIndexValidationError);
    expect(await failing.resolveSemanticLaneStatus()).toMatchObject({
      availability: 'stale',
      reason: 'missing-snapshot',
    });
    expect(await failing.searchSemantic('KajiyaDiffuse')).toEqual([]);
  });

  it('persists vectors so a new instance can repeat the same hit', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'rdc-semantic-'));
    const snapshotPath = path.join(root, 'semantic-index.json');
    const storage = new StorageIo();
    const first = createService({
      settings: selectedSettings(),
      storage,
      snapshotPath,
    });
    const ready = await first.rebuildSemanticIndex();
    expect(ready.availability).toBe('ready');
    const firstHits = await first.searchSemantic('KajiyaDiffuse hair');
    expect(firstHits[0]?.cardId).toBe(fixtureDoc.cardId);
    expect(firstHits[0]?.chunkIndex).toBe(0);
    expect(firstHits[0]?.relativePath).toBe(fixtureDoc.relativePath);

    const second = createService({
      settings: selectedSettings(),
      storage,
      snapshotPath,
    });
    expect((await second.resolveSemanticLaneStatus()).availability).toBe('ready');
    const secondHits = await second.searchSemantic('KajiyaDiffuse hair');
    expect(secondHits).toEqual(firstHits);
    const again = await first.rebuildSemanticIndex();
    expect(again.snapshot?.vectors).toEqual(ready.snapshot?.vectors);
    expect(again.snapshot?.chunks).toEqual(ready.snapshot?.chunks);
  });

  it('goes stale and returns no semantic hits after a new card is added without rebuild', async () => {
    const documents = [fixtureDoc];
    const service = createService({ settings: selectedSettings(), documents });
    expect((await service.rebuildSemanticIndex()).availability).toBe('ready');
    expect((await service.searchSemantic('KajiyaDiffuse')).length).toBeGreaterThan(0);

    documents.push({
      cardId: 'user:facts/new.md',
      spaceId: 'user',
      relativePath: 'facts/new.md',
      title: 'New fact',
      type: 'fact',
      lifecycle: 'draft',
      body: 'A newly added knowledge card about Adreno hair.',
      contentHash: 'def456',
    });

    expect(await service.resolveSemanticLaneStatus()).toMatchObject({
      availability: 'stale',
      reason: 'corpus-hash-mismatch',
    });
    expect(await service.searchSemantic('KajiyaDiffuse')).toEqual([]);
  });

  it('embeds through an opaque embed lease with batching', async () => {
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { input: string[] };
      return {
        ok: true,
        json: async () => ({
          data: body.input.map((_, index) => ({
            index,
            embedding: Array.from({ length: 1536 }, () => 0.1),
          })),
        }),
      };
    });
    const release = vi.fn();
    const service = new EmbeddingExecutionService({
      getCatalog: () => catalog,
      getSettings: () => ({
        providerId: 'openai',
        modelId: 'text-embedding-3-small',
        allowKnowledgeUpload: true,
      }),
      isProviderConfigured: () => true,
      snapshotPath: () => '/tmp/semantic-index.json',
      storage: createMemoryStorage(),
      freeze: async () => ({ handle: 'lease-embed' }),
      release,
      readLease: () => ({
        provider: { apiKey: 'sk-test' },
        connectionHeaders: {},
      }),
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => new Date('2026-09-01T00:00:00.000Z'),
      batchSize: 2,
      interBatchDelayMs: 0,
      sleep: async () => undefined,
      listCorpusDocuments: async () => [],
      getCorpusHash: async () => knowledgeCorpusHash([]),
    });

    const result = await service.embed(['a', 'b', 'c']);
    expect(result.dimensions).toBe(1536);
    expect(result.vectors).toHaveLength(3);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('https://api.openai.com/v1/embeddings');
    expect(release).toHaveBeenCalledWith('lease-embed');
  });

  it('fail-closes embed when the selected model is absent from EmbeddingCatalog', async () => {
    const service = createService({
      settings: {
        providerId: 'openai',
        modelId: 'not-an-embedding',
        allowKnowledgeUpload: true,
      },
    });
    expect((await service.resolveSemanticLaneStatus()).reason).toBe('model-unknown');
    await expect(service.embed(['x'])).rejects.toBeInstanceOf(EmbeddingUnconfiguredError);
  });
});
