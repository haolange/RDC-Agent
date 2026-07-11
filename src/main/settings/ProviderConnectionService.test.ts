import { describe, expect, it } from 'vitest';
import type { LlmProviderModel } from '@shared/types/settings';
import { mergeManagedModelAvailability, resolveCodingPlanModelsUrl } from './ProviderConnectionService';

const managed = (...ids: string[]): LlmProviderModel[] => ids.map((id) => ({
  id,
  label: id,
  enabled: true,
  availability: 'unknown',
}));

describe('resolveCodingPlanModelsUrl', () => {
  it('appends /v1/models when the coding base has no /v1 suffix', () => {
    expect(resolveCodingPlanModelsUrl('https://api.kimi.com/coding/')).toBe(
      'https://api.kimi.com/coding/v1/models',
    );
    expect(resolveCodingPlanModelsUrl('https://api.kimi.com/coding')).toBe(
      'https://api.kimi.com/coding/v1/models',
    );
  });

  it('appends /models when the base already ends with /v1', () => {
    expect(resolveCodingPlanModelsUrl('https://api.kimi.com/coding/v1')).toBe(
      'https://api.kimi.com/coding/v1/models',
    );
    expect(resolveCodingPlanModelsUrl('https://api.kimi.com/coding/v1/')).toBe(
      'https://api.kimi.com/coding/v1/models',
    );
  });
});

describe('mergeManagedModelAvailability', () => {
  it('keeps app-managed catalog rows and disables models missing from the endpoint', () => {
    const models = mergeManagedModelAvailability(
      managed('kimi-for-coding', 'catalog-only-model'),
      [{ id: 'kimi-for-coding', label: 'kimi-for-coding', enabled: true }],
    );

    expect(models).toEqual([
      expect.objectContaining({
        id: 'kimi-for-coding',
        enabled: true,
        availability: 'available',
        availabilityReason: undefined,
      }),
      expect.objectContaining({
        id: 'catalog-only-model',
        enabled: false,
        availability: 'unavailable',
      }),
    ]);
  });

  it('keeps the catalog unchanged when no live model list is available', () => {
    expect(mergeManagedModelAvailability(managed('gpt-5.5'), [])).toEqual([
      expect.objectContaining({
        id: 'gpt-5.5',
        enabled: true,
        availability: 'unknown',
      }),
    ]);
  });
});
