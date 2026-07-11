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
import { NAMED_REASONING_LEVELS, REASONING_SELECTIONS } from '../types/modelCapability';

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

  it('uses the no-Auto canonical reasoning selections', () => {
    expect(REASONING_SELECTIONS).toEqual(['off', 'on', ...NAMED_REASONING_LEVELS]);
    const serializedCatalog = JSON.stringify(MANAGED_PROVIDER_MODEL_CATALOG);
    expect(serializedCatalog).not.toContain('"auto"');
    expect(serializedCatalog).not.toContain('"extHigh"');
    expect(serializedCatalog).toContain('"extra"');
  });

  it('keeps Kimi Coding Plan on a single official toggle model', () => {
    const kimi = createBuiltinProviderEntry('kimi-coding-plan');
    const entry = lookupManagedModelCatalogEntry('kimi-coding-plan', 'kimi-for-coding');

    expect(kimi.models.map((model) => model.id)).toEqual(['kimi-for-coding']);
    expect(entry?.profile.reasoningControl).toMatchObject({
      kind: 'toggle',
      defaultSelection: 'on',
      supportsOff: true,
    });
    expect(entry?.profile.fastVariantModelId).toBeUndefined();
  });

  it('captures multi-level and always-on variants without legacy fields', () => {
    expect(lookupManagedModelCatalogEntry('openai', 'gpt-5.6-sol')?.profile.reasoningControl).toMatchObject({
      kind: 'levels',
      supportsOff: true,
      levels: ['low', 'medium', 'high', 'extra', 'max'],
      defaultSelection: 'medium',
    });
    expect(lookupManagedModelCatalogEntry('openai', 'gpt-5.6')?.id).toBe('gpt-5.6-sol');

    expect(lookupManagedModelCatalogEntry('openai', 'gpt-5.5')?.profile.reasoningControl).toMatchObject({
      kind: 'levels',
      supportsOff: true,
      levels: ['low', 'medium', 'high', 'extra'],
      defaultSelection: 'medium',
    });

    expect(lookupManagedModelCatalogEntry('xai', 'grok-4.5')?.profile).toMatchObject({
      nominalContextWindowTokens: 500_000,
      reasoningControl: {
        kind: 'levels',
        supportsOff: true,
        levels: ['low', 'medium', 'high'],
        defaultSelection: 'high',
      },
    });

    expect(lookupManagedModelCatalogEntry('anthropic', 'claude-fable-5')?.profile.reasoningControl).toMatchObject({
      kind: 'levels',
      supportsOff: false,
      levels: ['low', 'medium', 'high', 'extra', 'max'],
      defaultSelection: 'high',
    });

    expect(lookupManagedModelCatalogEntry('minimax-cn', 'MiniMax-M2.7')?.profile.reasoningControl).toMatchObject({
      kind: 'always-on',
      lockedSelection: 'on',
    });
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
