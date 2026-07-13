import type { LlmProviderEntry } from '@shared/types/settings';
import type { ProviderConnectionDraft } from './types';

export function projectConnectionProvider(
  provider: LlmProviderEntry | null,
  draft: ProviderConnectionDraft | null,
): LlmProviderEntry | null {
  if (!provider || !draft) return provider;
  const authMode = draft.authMode;
  const availability = provider.authModeAvailability?.[authMode] ?? provider.providerAvailability;
  const isConfigured = provider.configuredAuthMode === authMode && provider.isConfigured;
  return {
    ...provider,
    authMode,
    activeAccountId: provider.authAccountIds?.[authMode],
    hasStoredSecret: provider.hasStoredSecretByAuthMode?.[authMode] === true,
    status: availability.state === 'unavailable'
      ? 'unavailable'
      : isConfigured
        ? provider.status
        : 'unconfigured',
    enabled: isConfigured && provider.enabled,
    isConfigured,
    unavailableReason: availability.state === 'unavailable' ? availability.reason : undefined,
  };
}

export function createProviderConnectionDraft(provider: LlmProviderEntry): ProviderConnectionDraft {
  const models = provider.models.map((model) => ({ ...model }));
  return {
    providerId: provider.id,
    authMode: provider.authMode,
    protocol: provider.protocol,
    apiKey: '',
    baseUrl: provider.baseUrl ?? '',
    showApiKey: false,
    usingStoredSecret: provider.authMode === 'api-key'
      && (provider.hasStoredSecretByAuthMode?.['api-key'] ?? provider.hasStoredSecret),
    busy: 'idle',
    error: '',
    discoveryDiagnostic: null,
    testedApiKey: '',
    testedBaseUrl: '',
    testedProtocol: provider.protocol,
    testedAuthMode: provider.authMode,
    models,
    accountStatus: provider.authMode === 'account' && provider.configuredAuthMode === 'account' && provider.isConfigured
      ? {
          providerId: provider.id,
          state: 'connected',
          available: true,
          connected: true,
          accountLabel: provider.accountLabel,
          planLabel: provider.planLabel,
          expiresAt: provider.oauthExpiresAt,
          models,
        }
      : undefined,
    accountLoginMode: provider.id === 'grok-account' ? 'browser' : 'device',
    accountRegion: 'global',
    authCode: '',
  };
}
