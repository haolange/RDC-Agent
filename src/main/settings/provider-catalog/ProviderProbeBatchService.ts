import { randomUUID } from 'node:crypto';
import { settingsService } from '../settings-core/SettingsService';
import { providerConnectionService } from '../provider-auth/ProviderConnectionService';
import { loadProviderSurface } from '../../provider-catalog/ProviderCatalogRegistry';
import { isProbeAvailabilityDenied } from './ProviderProbeEvidence';
import { resolveEffectiveCatalog } from './EffectiveModelResolver';
import { providerCapabilityProbeService } from './ProviderCapabilityProbeService';
import type { LlmModelCapabilityProbeResult, LlmProviderEntry } from '@shared/types/settings';
import type { ProviderProbeBatch, ProviderProbeBatchItem, ProviderProbeBatchRequest } from '@shared/types/providerProbe';
import type { EffectiveModel } from '@shared/types/providerCapability';

export interface ProbeBatchDependencies {
  providers(): LlmProviderEntry[];
  refresh(providerId: string): Promise<string | undefined>;
  models(providerId: string): EffectiveModel[];
  test(item: ProviderProbeBatchItem, signal: AbortSignal): Promise<LlmModelCapabilityProbeResult>;
}

const production: ProbeBatchDependencies = {
  providers: () => settingsService.getAll().llm.providers,
  refresh: async id => {
    await loadProviderSurface(id);
    const result = await providerConnectionService.refreshProviderModels(id);
    return result.success ? undefined : result.error;
  },
  models: id => resolveEffectiveCatalog(id, settingsService.getAll())?.models ?? [],
  test: (item, signal) => providerCapabilityProbeService.test(item, signal),
};

export function modelProbeItems(providerId: string, model: EffectiveModel): ProviderProbeBatchItem[] {
  const item = (mode: ProviderProbeBatchItem['mode'], detail?: string): ProviderProbeBatchItem => ({
    providerId, modelId: model.modelId, mode, state: detail ? 'skipped' : 'pending', ...(detail ? { detail } : {}),
  });
  if (model.selection?.pickerVisibility === 'internal') return [];
  const blocked = !model.enabled ? 'Model is disabled.'
    : model.availability === 'unavailable' ? model.unavailableReason ?? 'Model is unavailable.' : undefined;
  const items = [item('default', blocked)];
  if (model.controls.maxContext.state === 'selectable') items.push(item('max-context', blocked));
  else if (model.controls.maxContext.state === 'unsupported') items.push(item('max-context', 'Max mode is unsupported.'));
  if (model.controls.fast.state === 'selectable') items.push(item('fast', blocked));
  else if (model.controls.fast.state === 'unsupported') items.push(item('fast', 'Fast mode is unsupported.'));
  if (model.executionBindings?.some(b => b.when.fast === true && b.when.maxContext === true)) {
    items.push(item('fast-max-context', blocked));
  }
  return items;
}

/** Owns a single in-memory batch and joins its request before releasing cancellation. */
export class ProviderProbeBatchService {
  private batch: ProviderProbeBatch | null = null;
  private preparing = false;
  private revision = 0;
  private closed = false;
  private controller?: AbortController;
  private completion?: Promise<void>;
  private readonly identities = new Map<string, string>();
  private readonly listeners = new Set<(batch: ProviderProbeBatch) => void>();

  constructor(private readonly dependencies: ProbeBatchDependencies = production) {}

  subscribe(listener: (batch: ProviderProbeBatch) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get(id?: string): ProviderProbeBatch | null {
    return this.batch && (!id || this.batch.id === id) ? structuredClone(this.batch) : null;
  }

  async prepare(request: ProviderProbeBatchRequest): Promise<ProviderProbeBatch> {
    if (this.closed || this.preparing || this.batch?.state === 'running' || this.batch?.state === 'cancelling') {
      throw new Error('A capability batch is running or preparing.');
    }
    this.preparing = true;
    try {
      const previous = request.retryRunId ? this.get(request.retryRunId) : null;
      if (request.retryRunId && (!previous || previous.state === 'ready')) throw new Error('Retry batch is no longer available.');
      const retryKeys = previous ? new Set(previous.items.filter(i => i.result && !i.result.success)
        .map(i => `${i.providerId}\0${i.modelId}\0${i.mode}`)) : null;
      const providers = this.dependencies.providers().filter(p => p.enabled && p.isConfigured
        && (!request.providerIds || request.providerIds.includes(p.id)));
      const batch: ProviderProbeBatch = {
        id: randomUUID(), revision: 0, state: 'ready', items: [], modelCount: 0, requestCount: 0, discoveryErrors: [],
      };
      this.identities.clear();
      for (const provider of providers) {
        const detail = await this.dependencies.refresh(provider.id);
        if (detail) batch.discoveryErrors.push({ providerId: provider.id, detail });
        const current = this.dependencies.providers().find(p => p.id === provider.id);
        if (!current?.enabled || !current.isConfigured || current.activeAccountId !== provider.activeAccountId) continue;
        this.identities.set(provider.id, this.identity(current));
        batch.items.push(...this.dependencies.models(provider.id).flatMap(model => modelProbeItems(provider.id, retryKeys && isProbeAvailabilityDenied(model) ? { ...model, availability: 'available' } : model))
          .filter(i => !retryKeys || retryKeys.has(`${i.providerId}\0${i.modelId}\0${i.mode}`)));
      }
      batch.modelCount = new Set(batch.items.map(i => `${i.providerId}\0${i.modelId}`)).size;
      batch.requestCount = batch.items.filter(i => i.state === 'pending').length;
      if (this.closed) throw new Error('Capability batches are shutting down.');
      this.batch = batch;
      this.emit();
      return structuredClone(batch);
    } finally { this.preparing = false; }
  }

  start(id: string): ProviderProbeBatch {
    if (this.closed || !this.batch || this.batch.id !== id || this.batch.state !== 'ready') throw new Error('Batch is not ready.');
    this.batch.state = 'running';
    this.controller = new AbortController();
    this.completion = this.run(this.batch, this.controller.signal);
    this.emit();
    return structuredClone(this.batch);
  }

  async cancel(id: string): Promise<ProviderProbeBatch | null> {
    if (!this.batch || this.batch.id !== id) return null;
    if (this.batch.state === 'running' || this.batch.state === 'cancelling') {
      this.batch.state = 'cancelling';
      this.controller?.abort();
      this.emit();
      await this.completion;
    } else if (this.batch.state === 'ready') {
      this.batch.items.forEach(i => { if (i.state === 'pending') i.state = 'cancelled'; });
      this.batch.state = 'cancelled';
      this.emit();
    }
    return this.get(id);
  }

  async dispose(): Promise<void> {
    this.closed = true;
    if (this.batch) await this.cancel(this.batch.id);
  }

  private async run(batch: ProviderProbeBatch, signal: AbortSignal): Promise<void> {
    const blocked = new Map<string, string>();
    const deniedModels = new Set<string>();
    for (const item of batch.items) {
      if (item.state !== 'pending') continue;
      if (signal.aborted) { item.state = 'cancelled'; continue; }
      if (deniedModels.has(`${item.providerId}\0${item.modelId}`)) { item.state = 'skipped'; item.detail = 'Current account is not entitled to this model.'; continue; }
      const provider = this.dependencies.providers().find(p => p.id === item.providerId);
      if (!provider || this.identity(provider) !== this.identities.get(item.providerId)) {
        blocked.set(item.providerId, 'Provider configuration changed; prepare a new batch.');
      }
      if (blocked.has(item.providerId)) { item.state = 'skipped'; item.detail = blocked.get(item.providerId); continue; }
      item.state = 'running';
      this.emit();
      try { item.result = await this.dependencies.test(item, signal); }
      catch (error) { item.result = { success: false, status: 'failed', requestSent: false, detail: error instanceof Error ? error.message : String(error) }; }
      item.state = signal.aborted ? 'cancelled' : 'settled';
      if (item.mode === 'default' && item.result.failureKind === 'entitlement-denied') deniedModels.add(`${item.providerId}\0${item.modelId}`);
      if (item.result.failureKind === 'authentication-failed' || item.result.failureKind === 'quota-exhausted') {
        blocked.set(item.providerId, item.result.detail ?? item.result.failureKind);
      }
      this.emit();
    }
    batch.state = signal.aborted ? 'cancelled' : 'completed';
    this.emit();
  }

  private emit(): void {
    if (!this.batch) return;
    this.batch.revision = ++this.revision;
    for (const listener of this.listeners) listener(structuredClone(this.batch));
  }

  private identity(provider: LlmProviderEntry): string {
    return JSON.stringify([provider.enabled, provider.isConfigured, provider.activeAccountId, provider.secretRef,
      provider.protocol, provider.baseUrl, provider.connectionValues, provider.models]);
  }
}

export const providerProbeBatchService = new ProviderProbeBatchService();
