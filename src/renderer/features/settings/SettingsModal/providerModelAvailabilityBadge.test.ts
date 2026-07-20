import { describe, expect, it } from 'vitest';
import { resolveProviderModelAvailabilityBadge } from './providerModelAvailabilityBadge';

describe('resolveProviderModelAvailabilityBadge', () => {
  it('never flashes unverified while loading or refreshing', () => {
    expect(resolveProviderModelAvailabilityBadge({
      availability: 'unknown',
      enabled: true,
      loading: true,
      refreshing: false,
    })).toBe('loading');
    expect(resolveProviderModelAvailabilityBadge({
      availability: 'unknown',
      enabled: true,
      loading: false,
      refreshing: true,
    })).toBe('loading');
  });

  it('returns available once evidence is present and idle', () => {
    expect(resolveProviderModelAvailabilityBadge({
      availability: 'available',
      enabled: true,
      loading: false,
      refreshing: false,
    })).toBe('available');
  });

  it('keeps unavailable and disabled ahead of loading', () => {
    expect(resolveProviderModelAvailabilityBadge({
      availability: 'unavailable',
      enabled: true,
      loading: true,
      refreshing: true,
    })).toBe('unavailable');
    expect(resolveProviderModelAvailabilityBadge({
      availability: 'available',
      enabled: false,
      loading: true,
      refreshing: false,
    })).toBe('disabled');
  });
});
