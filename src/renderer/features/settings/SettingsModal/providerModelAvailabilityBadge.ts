import type { LlmProviderModel } from '@shared/types/settings';

export type ProviderModelAvailabilityBadge =
  | 'unavailable'
  | 'disabled'
  | 'loading'
  | 'unverified'
  | 'available';

/**
 * Single badge state machine for Provider Connect model rows.
 * Refreshing/loading must never flash Unverified.
 */
export function resolveProviderModelAvailabilityBadge(input: {
  availability: LlmProviderModel['availability'] | 'available' | 'unavailable' | 'unknown' | undefined;
  enabled: boolean;
  loading: boolean;
  refreshing: boolean;
}): ProviderModelAvailabilityBadge {
  const availability = input.availability ?? 'unknown';
  if (availability === 'unavailable') return 'unavailable';
  if (!input.enabled) return 'disabled';
  if (input.loading || input.refreshing) return 'loading';
  if (availability === 'unknown') return 'unverified';
  return 'available';
}
