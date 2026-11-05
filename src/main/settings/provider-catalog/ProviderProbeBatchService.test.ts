import { describe, expect, it, vi } from 'vitest';
import { modelProbeItems, ProviderProbeBatchService, type ProbeBatchDependencies } from './ProviderProbeBatchService';
import type { EffectiveModel } from '@shared/types/providerCapability';
import type { LlmModelCapabilityProbeResult, LlmProviderEntry } from '@shared/types/settings';

const model = (id = 'm'): EffectiveModel => ({
  modelId: id, enabled: true, availability: 'available', selection: { pickerVisibility: 'primary' },
  controls: { fast: { state: 'selectable', defaultValue: false, entitlement: 'unknown' },
    maxContext: { state: 'fixed', fixedValue: true } },
} as EffectiveModel);
const provider = (id = 'p'): LlmProviderEntry => ({ id, enabled: true, isConfigured: true, activeAccountId: 'a' } as LlmProviderEntry);
const verified = () => ({ success: true as const, status: 'verified' as const, requestSent: true });
function fixture() {
  const providers = [provider(), provider('q')];
  const dependencies: ProbeBatchDependencies = {
    providers: () => providers, refresh: vi.fn(async () => undefined),
    models: () => [model()], test: vi.fn(async () => verified()),
  };
  return { providers, dependencies, service: new ProviderProbeBatchService(dependencies) };
}

describe('ProviderProbeBatchService', () => {
  it('deduplicates fixed Max and hides internal targets; records unsupported modes without requests', () => {
    expect(modelProbeItems('p', model()).map(i => i.mode)).toEqual(['default', 'fast']);
    expect(modelProbeItems('p', { ...model(), selection: { pickerVisibility: 'internal' } })).toEqual([]);
    const unsupported = model();
    unsupported.controls.fast = { state: 'unsupported', fixedValue: false };
    expect(modelProbeItems('p', unsupported).at(-1)).toMatchObject({ mode: 'fast', state: 'skipped' });
    const disabled = modelProbeItems('p', { ...model(), enabled: false });
    expect(disabled.every(i => i.state === 'skipped')).toBe(true);
  });

  it('prepares current configured providers and probes sequentially without retrying successes', async () => {
    const f = fixture();
    let running = 0;
    f.dependencies.test = vi.fn(async () => {
      expect(running++).toBe(0);
      await Promise.resolve();
      running--;
      return verified();
    });
    const batch = await f.service.prepare({});
    expect(batch).toMatchObject({ modelCount: 2, requestCount: 4, state: 'ready' });
    const finished = new Promise<void>(resolve => f.service.subscribe(b => { if (b.state === 'completed') resolve(); }));
    f.service.start(batch.id);
    expect(() => f.service.start(batch.id)).toThrow('not ready');
    await finished;
    expect(f.dependencies.test).toHaveBeenCalledTimes(4);
    expect((await f.service.prepare({ retryRunId: batch.id })).requestCount).toBe(0);
  });

  it('blocks only the provider with exhausted quota and continues independent providers', async () => {
    const f = fixture();
    f.dependencies.test = vi.fn(async (item): Promise<LlmModelCapabilityProbeResult> => item.providerId === 'p'
      ? { success: false, status: 'failed', requestSent: true, failureKind: 'quota-exhausted' }
      : verified());
    const batch = await f.service.prepare({});
    const finished = new Promise<void>(resolve => f.service.subscribe(b => { if (b.state === 'completed') resolve(); }));
    f.service.start(batch.id);
    await finished;
    expect(f.service.get()?.items.map(i => i.state)).toEqual(['settled', 'skipped', 'settled', 'settled']);
    expect(f.dependencies.test).toHaveBeenCalledTimes(3);
  });

  it('joins a cancelled request and never dispatches subsequent items', async () => {
    const f = fixture();
    let settle!: () => void;
    f.dependencies.test = vi.fn((_item, signal) => new Promise<LlmModelCapabilityProbeResult>(resolve => {
      signal.addEventListener('abort', () => { settle = () => resolve({ success: false, status: 'cancelled', requestSent: true }); });
    }));
    const batch = await f.service.prepare({});
    f.service.start(batch.id);
    const cancellation = f.service.cancel(batch.id);
    expect(f.service.get()?.state).toBe('cancelling');
    expect(f.dependencies.test).toHaveBeenCalledOnce();
    settle();
    await cancellation;
    expect(f.service.get()?.state).toBe('cancelled');
    expect(f.service.get()?.items.every(i => i.state === 'cancelled')).toBe(true);
  });

  it('does not send requests after an account changed since preparation', async () => {
    const f = fixture();
    const batch = await f.service.prepare({ providerIds: ['p'] });
    f.providers[0] = { ...f.providers[0], activeAccountId: 'other' };
    f.service.start(batch.id);
    expect(f.dependencies.test).not.toHaveBeenCalled();
    expect(f.service.get()?.items.every(i => i.state === 'skipped')).toBe(true);
  });

  it('keeps refresh failures visible and refuses batches during disposal', async () => {
    const f = fixture();
    f.dependencies.refresh = async () => 'catalog unavailable';
    const batch = await f.service.prepare({ providerIds: ['p'] });
    expect(batch.discoveryErrors).toEqual([{ providerId: 'p', detail: 'catalog unavailable' }]);
    await f.service.dispose();
    await expect(f.service.prepare({})).rejects.toThrow('running or preparing');
  });
});


it('keeps batch revisions monotonic across preparations', async () => {
  const f = fixture();
  const first = await f.service.prepare({});
  const second = await f.service.prepare({});
  expect(second.revision).toBeGreaterThan(first.revision);
});
