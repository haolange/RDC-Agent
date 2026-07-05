import { describe, expect, it } from 'vitest';
import type { LlmProviderModel } from '@shared/types/settings';
import { mergeManagedModelAvailability } from './ProviderConnectionService';

const managed = (...ids: string[]): LlmProviderModel[] => ids.map((id) => ({
  id,
  label: id,
  enabled: true,
  availability: 'unknown',
}));

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
