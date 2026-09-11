import type { TranslationKey } from '../../../../i18n';
import type { LlmProviderEntry } from '@shared/types/settings';

/**
 * Auth state, configuration state and the last test result are separate facts.
 * The card tone only escalates for a real failure; anything not yet configured
 * stays neutral.
 */
export type ProviderCardTone = 'neutral' | 'connected' | 'error';

export interface ProviderCardStatus {
  tone: ProviderCardTone;
  labelKey: TranslationKey;
  /** Full failure text, shown as a summary with an explicit expander. */
  detail: string;
}

export function resolveProviderCardStatus(provider: LlmProviderEntry): ProviderCardStatus {
  const unavailableReason = provider.unavailableReason?.trim() ?? '';
  if (provider.status === 'failed') {
    return { tone: 'error', labelKey: 'settings.providerFailed', detail: unavailableReason };
  }
  if (provider.status === 'unavailable') {
    return { tone: 'neutral', labelKey: 'settings.providerUnavailable', detail: unavailableReason };
  }
  if (provider.isConfigured && provider.status === 'verified') {
    return { tone: 'connected', labelKey: 'settings.providerConnected', detail: '' };
  }
  return { tone: 'neutral', labelKey: 'settings.providerUnconfigured', detail: unavailableReason };
}

export interface ProviderIdentitySummary {
  /** Account or connection identity, never a secret. */
  value: string;
  isPlaceholder: boolean;
}

export function resolveProviderIdentity(
  provider: LlmProviderEntry,
  unconfiguredLabel: string,
): ProviderIdentitySummary {
  const identity = [provider.accountLabel, provider.planLabel].filter(Boolean).join(' · ').trim();
  if (identity) return { value: identity, isPlaceholder: false };
  if (!provider.isConfigured) return { value: unconfiguredLabel, isPlaceholder: true };
  return { value: provider.id, isPlaceholder: false };
}

/** Overview shows a model count, never an inline catalog. */
export function countEnabledModels(provider: LlmProviderEntry): number {
  return provider.models.filter((model) => model.enabled).length;
}

export function isProviderActionBlocked(provider: LlmProviderEntry): boolean {
  return !provider.isConfigured && provider.providerAvailability.state === 'unavailable';
}
