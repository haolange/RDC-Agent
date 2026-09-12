import { describe, expect, it } from 'vitest';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';
import type { LlmProviderModel } from '@shared/types/settings';
import { mergeTestedProviderModels, projectProviderModels, updateProviderModelPreference } from './providerModelProjection';

it('refreshes discovered facts while retaining enabled choices and preferences, including models absent from discovery', () => {
  const result = mergeTestedProviderModels([
    { id: 'canonical', aliases: ['alias'], label: 'Live label', enabled: false, availability: 'available' },
    { id: 'new', label: 'New model', enabled: true },
  ], [
    { id: 'alias', label: 'Old label', enabled: true, defaultReasoningSelection: 'high' },
    { id: 'missing', label: 'Missing', enabled: false, availability: 'available' },
  ]);
  expect(result).toEqual([
    expect.objectContaining({ id: 'canonical', label: 'Live label', enabled: true, availability: 'available', defaultReasoningSelection: 'high' }),
    expect.objectContaining({ id: 'new', enabled: true }),
    expect.objectContaining({ id: 'missing', enabled: false, availability: 'unknown' }),
  ]);
});

function effectiveModel(modelId: string, label: string): EffectiveModel {
  return {
    providerId: 'provider-a', modelId, label, aliases: [], enabled: true,
    route: { protocol: 'OpenAIResponses', source: 'catalog' }, availability: 'available', presencePolicy: 'maintained',
    contextTiers: [{ id: 'default', label: 'Default', activation: { kind: 'implicit' }, entitlement: 'granted' }],
    defaultBudgetTokens: 128_000,
    controls: {
      fast: { state: 'unknown', defaultValue: false },
      maxContext: { state: 'unsupported', fixedValue: false },
      reasoning: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
    },
    toolCalling: { state: 'unknown' }, visionInput: { state: 'unknown' }, structuredOutput: { state: 'unknown' },
    provenance: [],
  };
}

function snapshot(models: EffectiveModel[]): EffectiveCatalogSnapshot {
  return {
    providerId: 'provider-a', accountId: 'account-a', protocol: 'OpenAIResponses', catalogRevision: 'test-catalog', models,
    generatedAt: '2026-07-13T00:00:00.000Z', stale: false, refreshing: false,
  };
}

describe('projectProviderModels', () => {
  it('shows the complete EffectiveCatalog for app-managed providers and preserves user preferences', () => {
    const stored: LlmProviderModel[] = [{
      id: 'model-a', label: 'Stale label', enabled: false,
      defaultReasoningSelection: 'high', defaultBudgetTokens: 96_000,
      preferredRouteOptionId: 'anthropic',
    }];
    const result = projectProviderModels('app-managed', stored, snapshot([
      effectiveModel('model-a', 'Live A'),
      effectiveModel('model-b', 'Live B'),
    ]));

    expect(result.map(({ model }) => model.id)).toEqual(['model-a', 'model-b']);
    expect(result[0].model).toMatchObject({
      label: 'Live A', enabled: false, availability: 'available',
      defaultReasoningSelection: 'high', defaultBudgetTokens: 96_000,
      preferredRouteOptionId: 'anthropic',
    });
    expect(result[1].model).toMatchObject({ label: 'Live B', enabled: true, availability: 'available' });
  });

  it('does not let EffectiveCatalog replace user-managed model definitions', () => {
    const stored = [{ id: 'custom-model', label: 'Custom', enabled: true }];
    expect(projectProviderModels(
      'user-managed',
      stored,
      snapshot([effectiveModel('catalog-model', 'Catalog')]),
    ).map(({ model }) => model.id)).toEqual(['custom-model']);
  });

  it('keeps a persisted app-managed row when the current snapshot no longer contains it', () => {
    const stored = [{ id: 'missing-model', label: 'Missing', enabled: false }];
    expect(projectProviderModels('app-managed', stored, snapshot([]))).toEqual([{
      model: stored[0], effectiveModel: null,
    }]);
  });

  it('hides an unreturned account-entitled model until live discovery or persisted diagnosis', () => {
    const base = effectiveModel('kimi-for-coding', 'Kimi for Coding');
    const k3 = {
      ...effectiveModel('k3', 'Kimi K3'),
      availability: 'unknown' as const,
      presencePolicy: 'account-entitled' as const,
    };

    expect(projectProviderModels(
      'app-managed',
      [{ id: 'kimi-for-coding', label: 'Kimi for Coding', enabled: true }],
      snapshot([base, k3]),
    ).map(({ model }) => model.id)).toEqual(['kimi-for-coding']);

    expect(projectProviderModels(
      'app-managed',
      [
        { id: 'kimi-for-coding', label: 'Kimi for Coding', enabled: true },
        { id: 'k3', label: 'Kimi K3', enabled: false },
      ],
      snapshot([base, k3]),
    ).map(({ model }) => model.id)).toEqual(['kimi-for-coding', 'k3']);
  });
  it('hides exact internal variants from the picker and removes stale persisted variant rows', () => {
    const primary = effectiveModel('kimi-for-coding', 'Kimi for Coding');
    const variant = {
      ...effectiveModel('kimi-for-coding-highspeed', 'kimi-for-coding-highspeed'),
      selection: { pickerVisibility: 'internal' as const, relatedPrimaryModelIds: ['kimi-for-coding'] },
    };
    expect(projectProviderModels(
      'app-managed',
      [{ id: 'kimi-for-coding-highspeed', label: 'Old Fast row', enabled: true }],
      snapshot([primary, variant]),
    ).map(({ model }) => model.id)).toEqual(['kimi-for-coding']);
  });

  it('rekeys an app-managed preference through a proven effective alias without duplicating it', () => {
    const stored: LlmProviderModel[] = [
      { id: 'claude-opus-4-8', label: 'Seed label', enabled: false },
      { id: 'claude-opus-4.8', label: 'Duplicate', enabled: true },
    ];
    expect(updateProviderModelPreference('app-managed', stored, 'claude-opus-4.8', {
      label: 'Claude Opus 4.8', enabled: true, aliases: ['claude-opus-4-8'],
    })).toEqual([{
      id: 'claude-opus-4.8', label: 'Claude Opus 4.8', enabled: true, aliases: ['claude-opus-4-8'],
    }]);
  });

  it('keeps user-managed model ids isolated even when aliases overlap', () => {
    const stored: LlmProviderModel[] = [{ id: 'custom-old', label: 'Old', enabled: true }];
    expect(updateProviderModelPreference('user-managed', stored, 'custom-new', {
      label: 'New', enabled: true, aliases: ['custom-old'],
    }).map((model) => model.id)).toEqual(['custom-old', 'custom-new']);
  });
});
