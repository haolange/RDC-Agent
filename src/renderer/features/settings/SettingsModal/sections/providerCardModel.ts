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

/** Overview shows a model count, never an inline catalog. */
export function countEnabledModels(provider: LlmProviderEntry): number {
  return provider.models.filter((model) => model.enabled).length;
}

export function isProviderActionBlocked(provider: LlmProviderEntry): boolean {
  return !provider.isConfigured && provider.providerAvailability.state === 'unavailable';
}
