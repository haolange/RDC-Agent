import type { TranslationKey, useI18n } from '../../../../i18n';
import type { LlmProviderAuthMode, LlmProviderEntry } from '@shared/types/settings';

/**
 * Auth state, configuration state and the last test result are separate facts.
 * The card tone only escalates for a real failure; anything not yet configured
 * stays neutral.
 */
export type ProviderCardTone = 'neutral' | 'connected' | 'error';

export interface ProviderCardStatus {
  tone: ProviderCardTone;
  labelKey: TranslationKey;
}

export function resolveProviderCardStatus(provider: LlmProviderEntry): ProviderCardStatus {
  if (provider.status === 'failed') {
    return { tone: 'error', labelKey: 'settings.providerFailed' };
  }
  if (provider.status === 'unavailable') {
    return { tone: 'neutral', labelKey: 'settings.providerUnavailable' };
  }
  if (provider.isConfigured && provider.status === 'verified') {
    return { tone: 'connected', labelKey: 'settings.providerConnected' };
  }
  return {
    tone: 'neutral',
    labelKey: provider.isConfigured ? 'settings.directory.configured' : 'settings.providerUnconfigured',
  };
}

export function authModeLabelKey(
  mode: LlmProviderAuthMode,
  provider: Pick<LlmProviderEntry, 'connectionSchema'>,
): TranslationKey {
  if (mode === 'api-key') {
    return provider.connectionSchema?.fields.some((field) => field.id !== 'apiKey')
      ? 'settings.providerAuthCredentials'
      : 'settings.providerAuthApiKey';
  }
  if (mode === 'account') return 'settings.providerAuthAccount';
  if (mode === 'environment') return 'settings.providerAuthEnvironment';
  if (mode === 'local') return 'settings.providerAuthLocal';
  return 'settings.providers.row.noKey';
}

export function connectHintKey(
  provider: Pick<LlmProviderEntry, 'authMode' | 'category' | 'connectionSchema'>,
): TranslationKey {
  return provider.category === 'coding-token-plan' && provider.authMode === 'api-key'
    ? 'settings.directory.plan'
    : authModeLabelKey(provider.authMode, provider);
}

export function providerIdentityDetail(
  provider: Pick<LlmProviderEntry, 'authMode' | 'category' | 'connectionSchema' | 'accountLabel' | 'planLabel'>,
  title: string,
  t: ReturnType<typeof useI18n>['t'],
): string {
  const parts = [t(connectHintKey(provider)), provider.accountLabel, provider.planLabel];
  return [...new Set(parts.filter((part) => part && part !== title))].join(' · ');
}

export function isProviderActionBlocked(provider: LlmProviderEntry): boolean {
  return !provider.isConfigured && provider.providerAvailability.state === 'unavailable';
}
