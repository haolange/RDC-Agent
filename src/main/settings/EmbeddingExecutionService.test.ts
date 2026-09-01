import { describe, expect, it, vi } from 'vitest';
import {
  EmbeddingConsentDeniedError,
  EmbeddingExecutionService,
  EmbeddingUnconfiguredError,
} from './EmbeddingExecutionService';
import type { EmbeddingCatalog, EmbeddingSettings, SemanticIndexSnapshot } from '@shared/types/embedding';
import { StorageIo } from '../sessions/StorageIo';

const catalog: EmbeddingCatalog = {
  schemaVersion: 1,
  catalogRevision: 'rev-1',
  models: [{
    providerId: 'openai',
    modelId: 'text-embedding-3-small',
    label: 'text-embedding-3-small',
    dimensions: 1536,
    protocol: 'OpenAICompatibleEmbeddings',
    adapterId: 'openai-compatible-embeddings',
    baseUrl: 'https://api.openai.com/v1',
    factSourceId: 'rdc-agent:openai:0',
  }],
};

function createStorage(): StorageIo {
  const files = new Map<string, unknown>();
  return {
    ensureDir: vi.fn(),
    readJson: (filePath: string) => (files.has(filePath) ? files.get(filePath) : null),
    writeJsonAtomic: (filePath: string, data: unknown) => {
      files.set(filePath, data);
    },
  } as unknown as StorageIo;
}

function createService(options: {
  settings?: EmbeddingSettings;
  configured?: boolean;
  fetch?: typeof fetch;
  storage?: StorageIo;
}): EmbeddingExecutionService {
  const storage = options.storage ?? createStorage();
  return new EmbeddingExecutionService({
    getCatalog: () => catalog,
    getSettings: () => options.settings ?? {
      providerId: null,
      modelId: null,
      allowKnowledgeUpload: false,
    },
    isProviderConfigured: () => options.configured !== false,
    snapshotPath: () => '/tmp/semantic-index.json',
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
  });
}

describe('EmbeddingExecutionService', () => {
  it('returns unavailable when embedding is unconfigured', () => {
    const status = createService({}).resolveSemanticLaneStatus();
    expect(status.availability).toBe('unavailable');
    expect(status.reason).toBe('unconfigured');
  });

  it('returns unavailable and never uploads when consent is off', async () => {
    const fetchImpl = vi.fn();
    const service = createService({
      settings: {
        providerId: 'openai',
        modelId: 'text-embedding-3-small',
        allowKnowledgeUpload: false,
      },
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const status = service.resolveSemanticLaneStatus();
    expect(status.availability).toBe('unavailable');
    expect(status.reason).toBe('consent-denied');
    await expect(service.embed(['secret knowledge'])).rejects.toBeInstanceOf(EmbeddingConsentDeniedError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('marks semantic lane stale after model or dimension change until explicit rebuild', async () => {
    const storage = createStorage();
    const selected: EmbeddingSettings = {
      providerId: 'openai',
      modelId: 'text-embedding-3-small',
      allowKnowledgeUpload: true,
    };
    const service = createService({ settings: selected, storage });
    expect(service.resolveSemanticLaneStatus()).toMatchObject({
      availability: 'stale',
      reason: 'missing-snapshot',
    });

    const ready = await service.rebuildSemanticIndex({ corpusHash: 'abc' });
    expect(ready.availability).toBe('ready');
    expect(ready.snapshot).toMatchObject({
      identity: 'openai:text-embedding-3-small',
      dimensions: 1536,
      chunker: 'plain-v1',
      corpusHash: 'abc',
    });

    storage.writeJsonAtomic('/tmp/semantic-index.json', {
      ...(ready.snapshot as SemanticIndexSnapshot),
      identity: 'openai:text-embedding-3-large',
    } satisfies SemanticIndexSnapshot);
    expect(service.resolveSemanticLaneStatus()).toMatchObject({
      availability: 'stale',
      reason: 'identity-mismatch',
    });

    storage.writeJsonAtomic('/tmp/semantic-index.json', {
      ...(ready.snapshot as SemanticIndexSnapshot),
      identity: 'openai:text-embedding-3-small',
      dimensions: 3072,
    } satisfies SemanticIndexSnapshot);
    expect(service.resolveSemanticLaneStatus()).toMatchObject({
      availability: 'stale',
      reason: 'dimension-mismatch',
    });
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
      storage: createStorage(),
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
    expect(service.resolveSemanticLaneStatus().reason).toBe('model-unknown');
    await expect(service.embed(['x'])).rejects.toBeInstanceOf(EmbeddingUnconfiguredError);
  });
});
