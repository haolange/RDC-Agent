import type { LlmProviderModel } from '@shared/types/settings';

export type ProviderModelAvailabilityBadge =
  'unavailable' | 'disabled' | 'loading' | 'refresh-failed' | 'unverified' | 'available';

/**
 * Single badge state machine for Provider Connect model rows. Loading never flashes "not confirmed",
 * and a failed catalog refresh is named as such instead of reading like an account verdict.
 */
export function resolveProviderModelAvailabilityBadge(input: {
  availability: LlmProviderModel['availability'] | 'available' | 'unavailable' | 'unknown' | undefined;
  enabled: boolean;
  loading: boolean;
  refreshing: boolean;
  /** Last catalog refresh failure; set while the model's availability is still unknown. */
  refreshError?: string;
}): ProviderModelAvailabilityBadge {
  const availability = input.availability ?? 'unknown';
  if (availability === 'unavailable') return 'unavailable';
  if (!input.enabled) return 'disabled';
  if (input.loading || (input.refreshing && availability === 'unknown')) return 'loading';
  if (availability === 'unknown') return input.refreshError ? 'refresh-failed' : 'unverified';
  return 'available';
}
