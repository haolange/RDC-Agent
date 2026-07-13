import { describe, expect, it } from 'vitest';
import {
  createProviderEntryFromPreset,
  getProviderPreset,
  getProviderSeedModels,
  listProviderPresets,
  lookupProviderSeedModel,
} from './ProviderPresetRegistry';

describe('ProviderPresetRegistry', () => {
  it('loads exactly one serializable schema-v1 preset for every legacy builtin', () => {
    const presets = listProviderPresets();
    expect(presets).toHaveLength(61);
    expect(new Set(presets.map((preset) => preset.id)).size).toBe(61);
    expect(presets.every((preset) => preset.schemaVersion === 1)).toBe(true);
    expect(() => JSON.stringify(presets)).not.toThrow();
  });

  it('creates Settings entries entirely from preset metadata and seeds', () => {
    const openai = createProviderEntryFromPreset('openai');
    expect(openai).toMatchObject({ protocol: 'OpenAIResponses', authMode: 'api-key', catalogOwnership: 'app-managed' });
    expect(openai.models.map((model) => model.id)).toEqual(getProviderSeedModels('openai').map((model) => model.id));
    expect(createProviderEntryFromPreset('custom-endpoint').models).toEqual([]);
  });

  it('preserves aliases, reasoning wire controls, Fast variants, and truthful tiers', () => {
    expect(lookupProviderSeedModel('openai', 'gpt-5.6')?.modelId).toBe('gpt-5.6-sol');
    expect(lookupProviderSeedModel('openai', 'gpt-5.5')?.reasoning.wireProfile).toMatchObject({ kind: 'openai-responses' });
    expect(lookupProviderSeedModel('kimi-coding-plan', 'kimi-for-coding')?.fast)
      .toMatchObject({ kind: 'model-variant', modelId: 'kimi-for-coding-highspeed' });
    expect(lookupProviderSeedModel('claude-account', 'claude-sonnet-5')?.contextTiers[1])
      .toMatchObject({ maxPromptTokens: 1_000_000, activation: { kind: 'header' }, entitlement: 'unknown' });
    expect(lookupProviderSeedModel('anthropic', 'claude-sonnet-5')?.contextTiers[1])
      .toMatchObject({ maxPromptTokens: 1_000_000, activation: { kind: 'implicit' }, entitlement: 'granted' });
  });

  it('keeps unavailable lifecycle state separate from connection status', () => {
    expect(getProviderPreset('gemini-account')).toMatchObject({ status: 'beta', availability: { state: 'unavailable' } });
    expect(createProviderEntryFromPreset('azure-openai')).toMatchObject({ status: 'unavailable', isConfigured: false });
  });

  it('projects multi-auth availability without collapsing account and API credentials', () => {
    expect(createProviderEntryFromPreset('openrouter')).toMatchObject({
      authMode: 'api-key',
      authModeOptions: ['api-key', 'account'],
      authModeAvailability: {
        'api-key': { state: 'unknown' },
        account: { state: 'unknown' },
      },
      lifecycleStatus: 'stable',
    });
    expect(createProviderEntryFromPreset('cline').authModeAvailability?.account).toMatchObject({
      state: 'unavailable',
    });
    expect(getProviderPreset('opencode-go')).toMatchObject({
      status: 'beta', availability: { state: 'unknown' },
    });
    expect(getProviderPreset('grok-account')).toMatchObject({
      status: 'beta', availability: { state: 'unknown' },
    });
  });
});
