import { describe, expect, it, vi } from 'vitest';
import { ProviderDefinitionMutationCoordinator } from './ProviderDefinitionMutationCoordinator';
import type {
  LlmProviderEntry,
  ProviderDefinitionSaveRequest,
  ProviderDefinitionSaveResult,
} from '@shared/types/settings';

const provider = (modelId: string): LlmProviderEntry => ({
  id: 'provider-under-test',
  label: 'Provider under test',
  category: 'compatible-access',
  authMode: 'api-key',
  protocol: 'OpenAICompatibleChatCompletions',
  baseUrl: 'https://example.test/v1',
  catalogOwnership: 'user-managed',
  lifecycleStatus: 'stable',
  providerAvailability: { state: 'available' },
  serviceOperator: 'example.test',
  endpointClass: 'user-endpoint',
  catalogProvenance: [],
  enabled: true,
  apiKey: '',
  hasStoredSecret: false,
  recommendedModels: [],
  status: 'unconfigured',
  isConfigured: false,
  models: [{ id: modelId, label: modelId, enabled: true }],
});

const committed = (request: ProviderDefinitionSaveRequest): ProviderDefinitionSaveResult => {
  const modelId = request.provider.models[0]?.id ?? 'unknown';
  const snapshot = {
    clientRevision: request.clientRevision,
    providerId: request.provider.id,
    commitHash: `commit-${modelId}`,
    provider: request.provider,
    catalogRevision: `catalog-${modelId}`,
  };
  return {
    ...snapshot,
    status: 'committed',
    lastSuccessful: snapshot,
  };
};

describe('ProviderDefinitionMutationCoordinator', () => {
  it('debounces A -> B -> C and lets the flush barrier commit only C', async () => {
    const commit = vi.fn(async (request: ProviderDefinitionSaveRequest) => committed(request));
    const coordinator = new ProviderDefinitionMutationCoordinator(commit, 60_000);
    const a = coordinator.enqueue({ provider: provider('a'), clientRevision: 1 });
    const b = coordinator.enqueue({ provider: provider('b'), clientRevision: 2 });
    const c = coordinator.enqueue({ provider: provider('c'), clientRevision: 3 });

    const barrier = await coordinator.flush('provider-under-test');
    const results = await Promise.all([a, b, c]);

    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit.mock.calls[0]?.[0].clientRevision).toBe(3);
    expect(results.map((result) => result.status)).toEqual(['superseded', 'superseded', 'committed']);
    expect(barrier?.commitHash).toBe('commit-c');
  });

  it('returns the last successful snapshot and fails the barrier when the latest revision fails', async () => {
    const lastSuccessful = {
      clientRevision: 3,
      providerId: 'provider-under-test',
      commitHash: 'commit-c',
      provider: provider('c'),
      catalogRevision: 'catalog-c',
    };
    const failed: ProviderDefinitionSaveResult = {
      clientRevision: 4,
      providerId: 'provider-under-test',
      status: 'failed',
      commitHash: lastSuccessful.commitHash,
      provider: lastSuccessful.provider,
      catalogRevision: lastSuccessful.catalogRevision,
      lastSuccessful,
      error: 'disk full',
    };
    const coordinator = new ProviderDefinitionMutationCoordinator(async () => failed, 60_000);
    const pending = coordinator.enqueue({ provider: provider('d'), clientRevision: 4 });

    await expect(coordinator.flush('provider-under-test')).rejects.toThrow('disk full');
    await expect(pending).resolves.toMatchObject({ status: 'failed', lastSuccessful });
    await expect(coordinator.flush('provider-under-test')).resolves.toEqual(lastSuccessful);
  });

  it('reports a transport failure only to the current revision and retains the committed baseline', async () => {
    const commit = vi.fn(async (request: ProviderDefinitionSaveRequest) => committed(request));
    const coordinator = new ProviderDefinitionMutationCoordinator(commit, 60_000);
    const baseline = coordinator.enqueue({ provider: provider('baseline'), clientRevision: 1 });
    await coordinator.flush('provider-under-test');
    const { lastSuccessful } = await baseline;

    commit.mockRejectedValueOnce(new Error('Connection lost'));
    const old = coordinator.enqueue({ provider: provider('old-choice'), clientRevision: 2 });
    const latest = coordinator.enqueue({ provider: provider('latest-choice'), clientRevision: 3 });

    await expect(coordinator.flush('provider-under-test')).rejects.toThrow('Connection lost');
    await expect(old).resolves.toMatchObject({ status: 'superseded', clientRevision: 2, lastSuccessful });
    await expect(latest).resolves.toMatchObject({ status: 'failed', clientRevision: 3, lastSuccessful });
  });

  it('does not roll back to another account when a newly connected account cannot save', async () => {
    const commit = vi.fn(async (request: ProviderDefinitionSaveRequest) => committed(request));
    const coordinator = new ProviderDefinitionMutationCoordinator(commit, 60_000);
    const previous = coordinator.enqueue({
      provider: { ...provider('previous'), activeAccountId: 'previous-account' }, clientRevision: 1,
    });
    await coordinator.flush('provider-under-test');
    await previous;

    commit.mockRejectedValueOnce(new Error('Connection lost'));
    const next = coordinator.enqueue({
      provider: { ...provider('next'), activeAccountId: 'next-account' }, clientRevision: 2,
    });
    await expect(coordinator.flush('provider-under-test')).rejects.toThrow('Connection lost');
    await expect(next).resolves.toMatchObject({ status: 'failed', provider: null, lastSuccessful: null });
  });
});
