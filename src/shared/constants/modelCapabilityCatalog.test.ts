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

  it('keeps Kimi Coding Plan on official toggle models with HighSpeed fast variant', () => {
    const kimi = createBuiltinProviderEntry('kimi-coding-plan');
    const entry = lookupManagedModelCatalogEntry('kimi-coding-plan', 'kimi-for-coding');
    const fast = lookupManagedModelCatalogEntry('kimi-coding-plan', 'kimi-for-coding-highspeed');

    expect(kimi.models.map((model) => model.id)).toEqual([
      'kimi-for-coding',
      'kimi-for-coding-highspeed',
    ]);
    expect(entry?.profile.reasoningControl).toMatchObject({
      kind: 'toggle',
      defaultSelection: 'on',
      supportsOff: true,
    });
    expect(entry?.profile.fast?.modelId).toBe('kimi-for-coding-highspeed');
    expect(fast?.profile.fast).toBeUndefined();
    expect(fast?.profile.fixedTemperature).toBe(1);
  });

  it('keeps Volcengine Coding Plan on the official Coding Plan model surface', () => {
    const volc = createBuiltinProviderEntry('volcengine-coding-plan');
    expect(volc.models.map((model) => model.id)).toEqual([
      'doubao-seed-2.0-code',
      'doubao-seed-2.0-pro',
      'doubao-seed-2.0-lite',
      'doubao-seed-code',
      'minimax-m2.7',
      'minimax-m2.5',
      'kimi-k2.7-code',
      'kimi-k2.7-code-highspeed',
      'kimi-k2.6',
      'kimi-k2.5',
      'glm-5.2',
      'glm-5.1',
      'glm-4.7',
      'deepseek-v4-pro',
      'deepseek-v4-flash',
      'deepseek-v3.2',
    ]);
    expect(lookupManagedModelCatalogEntry('volcengine-coding-plan', 'doubao-seed-2.1-pro')).toBeNull();
    expect(lookupManagedModelCatalogEntry('volcengine-coding-plan', 'glm-4.6')).toBeNull();
    expect(lookupManagedModelCatalogEntry('volcengine-coding-plan', 'glm-5.2')?.id).toBe('glm-5.2');
    expect(lookupManagedModelCatalogEntry('volcengine-coding-plan', 'glm-latest')?.id).toBe('glm-5.2');

    const pro = lookupManagedModelCatalogEntry('volcengine-coding-plan', 'doubao-seed-2.0-pro');
    const code = lookupManagedModelCatalogEntry('volcengine-coding-plan', 'doubao-seed-2.0-code');
    const lite = lookupManagedModelCatalogEntry('volcengine-coding-plan', 'doubao-seed-2.0-lite');
    expect(pro?.profile.fast?.modelId).toBe('doubao-seed-2.0-lite');
    expect(code?.profile.fast?.modelId).toBe('doubao-seed-2.0-lite');
    expect(lite?.profile.fast).toBeUndefined();
    expect(pro?.profile.reasoningControl).toMatchObject({
      kind: 'levels',
      supportsOff: true,
      levels: ['minimal', 'low', 'medium', 'high'],
      defaultSelection: 'medium',
    });
    expect(lookupManagedModelCatalogEntry('volcengine-coding-plan', 'kimi-k2.7-code')?.profile.fast?.modelId)
      .toBe('kimi-k2.7-code-highspeed');
    expect(lookupManagedModelCatalogEntry('volcengine-coding-plan', 'deepseek-v4-pro')?.profile.reasoningControl).toMatchObject({
      kind: 'levels',
      supportsOff: true,
      levels: ['high', 'max'],
      defaultSelection: 'high',
    });
    expect(lookupManagedModelCatalogEntry('volcengine-coding-plan', 'deepseek-v3.2')?.profile.reasoningControl).toMatchObject({
      kind: 'levels',
      supportsOff: true,
      levels: ['high', 'max'],
      defaultSelection: 'high',
    });
    expect(volc.docsUrl).toBe('https://www.volcengine.com/docs/82379/1928261');
  });

  it('keeps ChatGPT Account on the Codex ChatGPT-sign-in model surface', () => {
    const chatgpt = createBuiltinProviderEntry('chatgpt-account');
    expect(chatgpt.models.map((model) => model.id)).toEqual([
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
    ]);
    expect(lookupManagedModelCatalogEntry('chatgpt-account', 'gpt-5.5-instant')).toBeNull();
    expect(lookupManagedModelCatalogEntry('chatgpt-account', 'gpt-5.5-thinking')).toBeNull();
    expect(lookupManagedModelCatalogEntry('chatgpt-account', 'gpt-5.5-pro')).toBeNull();
    expect(lookupManagedModelCatalogEntry('chatgpt-account', 'gpt-5.5')?.profile.reasoningControl).toMatchObject({
      kind: 'levels',
      supportsOff: true,
      levels: ['low', 'medium', 'high', 'extra'],
      defaultSelection: 'medium',
    });
  });

  it('keeps the Copilot Opus fast target out of the user-selectable catalog', () => {
    expect(lookupManagedModelCatalogEntry('github-copilot', 'claude-opus-4-8')?.profile.fast?.modelId)
      .toBe('claude-opus-4-8-fast');
    expect(lookupManagedModelCatalogEntry('github-copilot', 'claude-opus-4-8-fast')).toBeNull();
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
        supportsOff: false,
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

    expect(lookupManagedModelCatalogEntry('deepseek', 'deepseek-v4-pro')?.profile.reasoningControl).toMatchObject({
      kind: 'levels',
      supportsOff: true,
      levels: ['high', 'max'],
      defaultSelection: 'high',
    });

    expect(lookupManagedModelCatalogEntry('bailian-coding-plan', 'qwen3-coder-plus')?.profile.reasoningControl).toMatchObject({
      kind: 'none',
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
