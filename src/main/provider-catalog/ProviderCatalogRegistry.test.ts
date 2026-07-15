import { describe, expect, it } from 'vitest';
import {
  __testing,
  getLoadedProviderSurface,
  getProviderModelSummaries,
  listProviderSummaries,
  loadProviderSurface,
} from './ProviderCatalogRegistry';

describe('ProviderCatalogRegistry lazy loading', () => {
  it('keeps the summary index synchronous and deduplicates async surface loads', async () => {
    __testing.reset();

    const summaries = listProviderSummaries();
    expect(summaries).toHaveLength(181);
    expect(__testing.getLoadedSurfaceIds()).toEqual([]);
    expect(getLoadedProviderSurface('kimi-coding-plan')).toBeNull();

    const first = loadProviderSurface('kimi-coding-plan');
    const second = loadProviderSurface('kimi-coding-plan');
    expect(__testing.getPendingSurfaceIds()).toEqual(['kimi-coding-plan']);

    const [left, right] = await Promise.all([first, second]);
    expect(left?.id).toBe('kimi-coding-plan');
    expect(right).toEqual(left);
    expect(right).not.toBe(left);
    expect(__testing.getPendingSurfaceIds()).toEqual([]);
    expect(__testing.getLoadedSurfaceIds()).toEqual(['kimi-coding-plan']);
  });

  it('keeps account-entitled summaries unknown until a live account catalog confirms them', () => {
    __testing.reset();
    const models = getProviderModelSummaries('github-copilot');
    expect(models.find((model) => model.id === 'claude-opus-4.6')?.availability).toBe('unknown');
    expect(models.find((model) => model.id === 'claude-opus-4.8')?.availability).toBe('unknown');
  });
});
