import { describe, expect, it, vi } from 'vitest';

/** A fresh module instance, so no surface is loaded yet. */
async function freshRegistry() {
  vi.resetModules();
  return import('./ProviderCatalogRegistry');
}

describe('ProviderCatalogRegistry lazy loading', () => {
  it('keeps the summary index synchronous and loads a surface once, on demand', async () => {
    const registry = await freshRegistry();

    expect(registry.listProviderSummaries()).toHaveLength(182);
    expect(registry.getLoadedProviderSurface('kimi-coding-plan')).toBeNull();

    const [left, right] = await Promise.all([
      registry.loadProviderSurface('kimi-coding-plan'),
      registry.loadProviderSurface('kimi-coding-plan'),
    ]);
    expect(left?.id).toBe('kimi-coding-plan');
    // Catalog facts are frozen and shared, never cloned per reader.
    expect(right).toBe(left);
    expect(Object.isFrozen(right)).toBe(true);
    expect(registry.getLoadedProviderSurface('kimi-coding-plan')?.id).toBe('kimi-coding-plan');
  });

  it('keeps account-entitled summaries unknown until a live account catalog confirms them', async () => {
    const registry = await freshRegistry();
    const models = registry.getProviderModelSummaries('github-copilot');
    // Catalog-marked unavailable stays unavailable; available + account-entitled surfaces as unknown until live discovery.
    expect(models.find((model) => model.id === 'claude-opus-4.6')).toBeUndefined();
    expect(models.find((model) => model.id === 'claude-opus-4.8')?.availability).toBe('unknown');
  });
});
