import { describe, expect, it } from 'vitest';
import type { EffectiveCatalogSnapshot, EffectiveModel } from '@shared/types/providerCapability';
import type { LlmProviderModel } from '@shared/types/settings';
import { projectProviderModels, updateProviderModelPreference } from './providerModelProjection';

function effectiveModel(modelId: string, label: string): EffectiveModel {
  return {
    providerId: 'provider-a', modelId, label, aliases: [], enabled: true,
    route: { protocol: 'OpenAIResponses', source: 'preset' }, availability: 'available',
    contextTiers: [{ id: 'default', label: 'Default', activation: { kind: 'implicit' }, entitlement: 'granted' }],
    defaultBudgetTokens: 128_000, fast: { kind: 'unknown' },
    reasoning: { kind: 'none', supportsOff: true, levels: [], defaultSelection: 'off', wireProfile: { kind: 'none' } },
    toolCalling: { state: 'unknown' }, visionInput: { state: 'unknown' }, structuredOutput: { state: 'unknown' },
    provenance: [],
  };
}

function snapshot(models: EffectiveModel[]): EffectiveCatalogSnapshot {
  return {
    providerId: 'provider-a', accountId: 'account-a', protocol: 'OpenAIResponses', models,
    generatedAt: '2026-07-13T00:00:00.000Z', stale: false, refreshing: false,
  };
}

describe('projectProviderModels', () => {
  it('shows the complete EffectiveCatalog for app-managed providers and preserves user preferences', () => {
    const stored: LlmProviderModel[] = [{
      id: 'model-a', label: 'Stale label', enabled: false,
      defaultReasoningSelection: 'high', defaultBudgetTokens: 96_000,
    }];
    const result = projectProviderModels('app-managed', stored, snapshot([
      effectiveModel('model-a', 'Live A'),
      effectiveModel('model-b', 'Live B'),
    ]));

    expect(result.map(({ model }) => model.id)).toEqual(['model-a', 'model-b']);
    expect(result[0].model).toMatchObject({
      label: 'Live A', enabled: false, availability: 'available',
      defaultReasoningSelection: 'high', defaultBudgetTokens: 96_000,
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
