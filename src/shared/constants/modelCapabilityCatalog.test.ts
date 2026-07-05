import { describe, expect, it } from 'vitest';
import {
  createBuiltinProviderEntry,
  getBuiltinProviderCatalogOwnership,
} from './llm';
import {
  getManagedProviderModelIds,
  getManagedProviderModels,
  lookupManagedModelCatalogEntry,
  MANAGED_PROVIDER_MODEL_CATALOG,
} from './modelCapabilityCatalog';
import { EFFORT_LEVELS, REASONING_LEVELS } from '../types/modelCapability';

describe('managed provider model catalog', () => {
  it('owns mainline official and coding plan providers', () => {
    expect(getBuiltinProviderCatalogOwnership('openai')).toBe('app-managed');
    expect(getBuiltinProviderCatalogOwnership('claude-account')).toBe('app-managed');
    expect(getBuiltinProviderCatalogOwnership('vertex')).toBe('app-managed');
    expect(getBuiltinProviderCatalogOwnership('kimi-coding-plan')).toBe('app-managed');
  });

  it('does not own third-party compatible or local providers', () => {
    expect(getBuiltinProviderCatalogOwnership('openrouter')).toBe('user-managed');
    expect(getBuiltinProviderCatalogOwnership('custom-endpoint')).toBe('user-managed');
    expect(getBuiltinProviderCatalogOwnership('ollama')).toBe('user-managed');
  });

  it('builds provider entries from the app-managed catalog', () => {
    const openai = createBuiltinProviderEntry('openai');

    expect(openai.catalogOwnership).toBe('app-managed');
    expect(openai.models.map((model) => model.id)).toEqual(getManagedProviderModelIds('openai'));
    expect(openai.models.length).toBeGreaterThan(0);
  });

  it('uses ExtHigh as the canonical upper effort level', () => {
    expect(REASONING_LEVELS).toEqual(['off', 'auto', 'low', 'medium', 'high', 'extHigh', 'max']);
    expect(EFFORT_LEVELS).toEqual(['low', 'medium', 'high', 'extHigh', 'max']);
    const serializedCatalog = JSON.stringify(MANAGED_PROVIDER_MODEL_CATALOG);
    const retiredLevelName = ['ex', 'tra'].join('');
    expect(serializedCatalog).toContain('extHigh');
    expect(serializedCatalog).not.toContain(JSON.stringify(retiredLevelName));
  });

  it('keeps Kimi Coding Plan on the single official coding model', () => {
    const kimi = createBuiltinProviderEntry('kimi-coding-plan');
    const entry = lookupManagedModelCatalogEntry('kimi-coding-plan', 'kimi-for-coding');

    expect(kimi.models.map((model) => model.id)).toEqual(['kimi-for-coding']);
    expect(entry?.profile.reasoningMode).toBe('auto-only');
    expect(entry?.profile.supportedReasoningLevels).toEqual(['off', 'auto']);
    expect(entry?.profile.fastVariantModelId).toBeUndefined();
  });

  it('keeps user-managed provider entries free of managed models', () => {
    const custom = createBuiltinProviderEntry('custom-endpoint');

    expect(custom.catalogOwnership).toBe('user-managed');
    expect(getManagedProviderModels('custom-endpoint')).toEqual([]);
    expect(custom.models).toEqual([]);
  });

  it('resolves provider-aware aliases without applying them globally', () => {
    expect(lookupManagedModelCatalogEntry('anthropic', 'claude-haiku-4-5')?.id).toBe('claude-haiku-4-5-20251001');
    expect(lookupManagedModelCatalogEntry('openrouter', 'claude-haiku-4-5')).toBeNull();
  });
});
