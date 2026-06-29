import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { AppSettings, LlmAgentRoute, LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../i18n';
import type { ProviderConnectionDraft } from './types';
import { cloneProvider, cloneRoute, getEnabledModels } from './utils';

type Translate = ReturnType<typeof useI18n>['t'];

export interface UseProviderConnectionDraftOptions {
  open: boolean;
  providerDrafts: LlmProviderEntry[];
  setProviderDrafts: Dispatch<SetStateAction<LlmProviderEntry[]>>;
  setAgentRouteDrafts: Dispatch<SetStateAction<LlmAgentRoute[]>>;
  selectedProviderId: string | null;
  setSelectedProviderId: Dispatch<SetStateAction<string | null>>;
  connectionDraft: ProviderConnectionDraft | null;
  setConnectionDraft: Dispatch<SetStateAction<ProviderConnectionDraft | null>>;
  reloadSettings: () => Promise<AppSettings>;
  t: Translate;
}

export const useProviderConnectionDraft = ({
  open,
  providerDrafts,
  setProviderDrafts,
  setAgentRouteDrafts,
  selectedProviderId,
  setSelectedProviderId,
  connectionDraft,
  setConnectionDraft,
  reloadSettings,
  t,
}: UseProviderConnectionDraftOptions) => {
  const connectionProvider = useMemo(
    () => providerDrafts.find((provider) => provider.id === connectionDraft?.providerId) ?? null,
    [connectionDraft?.providerId, providerDrafts],
  );

  const refreshLocalSettings = async (preferredProviderId?: string) => {
    const nextSettings = await reloadSettings();
    const nextProviders = nextSettings.llm.providers.map(cloneProvider);
    setProviderDrafts(nextProviders);
    setAgentRouteDrafts(nextSettings.llm.agentRoutes.map(cloneRoute));
    setSelectedProviderId(
      preferredProviderId && nextProviders.some((provider) => provider.id === preferredProviderId)
        ? preferredProviderId
        : selectedProviderId && nextProviders.some((provider) => provider.id === selectedProviderId)
          ? selectedProviderId
          : nextProviders[0]?.id ?? null,
    );
    return nextSettings;
  };

  useEffect(() => {
    if (
      !open
      || !connectionDraft
      || connectionProvider?.authMode !== 'account'
      || connectionDraft.accountStatus?.state !== 'pending'
    ) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        const status = await window.electronAPI.llm.getProviderAccountStatus(connectionDraft.providerId);
        if (cancelled) {
          return;
        }
        if (status.connected) {
          const nextSettings = await reloadSettings();
          if (cancelled) {
            return;
          }
          const nextProviders = nextSettings.llm.providers.map(cloneProvider);
          setProviderDrafts(nextProviders);
          setAgentRouteDrafts(nextSettings.llm.agentRoutes.map(cloneRoute));
          setSelectedProviderId(
            nextProviders.some((provider) => provider.id === connectionDraft.providerId)
              ? connectionDraft.providerId
              : nextProviders[0]?.id ?? null,
          );
          setConnectionDraft(null);
          return;
        }
        if (status.state === 'failed' || status.state === 'unavailable') {
          setConnectionDraft((current) => current && current.providerId === connectionDraft.providerId
            ? {
              ...current,
              busy: 'idle',
              accountStatus: status,
              error: status.error ?? status.message ?? t('settings.providerSaveFailed'),
            }
            : current);
          return;
        }
        setConnectionDraft((current) => current && current.providerId === connectionDraft.providerId
          ? { ...current, accountStatus: status, error: '' }
          : current);
      })();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    connectionDraft?.accountStatus?.state,
    connectionDraft?.providerId,
    connectionProvider?.authMode,
    open,
    reloadSettings,
    setAgentRouteDrafts,
    setConnectionDraft,
    setProviderDrafts,
    setSelectedProviderId,
    t,
  ]);

  const openProviderConnection = (provider: LlmProviderEntry) => {
    const models = getEnabledModels(provider);
    setConnectionDraft({
      providerId: provider.id,
      protocol: provider.protocol,
      apiKey: '',
      baseUrl: provider.baseUrl ?? '',
      showApiKey: false,
      usingStoredSecret: provider.authMode === 'api-key' && provider.hasStoredSecret,
      busy: 'idle',
      error: '',
      testedApiKey: '',
      testedBaseUrl: '',
      testedProtocol: provider.protocol,
      models,
      accountStatus: provider.authMode === 'account' && provider.isConfigured
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
      authCode: '',
      oauthClientId: '',
    });
  };

  const updateConnectionDraft = (patch: Partial<ProviderConnectionDraft>) => {
    setConnectionDraft((current) => current ? { ...current, ...patch } : current);
  };

  const connectionNeedsApiKey = Boolean(
    connectionDraft
    && connectionProvider?.authMode === 'api-key'
    && !connectionProvider.hasStoredSecret
    && !connectionDraft.apiKey.trim(),
  );
  const connectionNeedsBaseUrl = Boolean(connectionDraft && connectionProvider?.baseUrlEditable && !connectionDraft.baseUrl.trim());
  const connectionHasFreshTest = Boolean(
    connectionDraft
    && connectionDraft.models.length > 0
    && connectionDraft.testedApiKey === connectionDraft.apiKey
    && connectionDraft.testedBaseUrl === connectionDraft.baseUrl
    && connectionDraft.testedProtocol === connectionDraft.protocol,
  );
  const connectionAccountConnected = Boolean(
    connectionDraft
    && connectionProvider?.authMode === 'account'
    && connectionProvider.isConfigured
    && connectionDraft.accountStatus?.connected,
  );
  const connectionDevicePending = Boolean(
    connectionDraft
    && connectionProvider?.authMode === 'account'
    && connectionDraft.accountStatus?.state === 'pending'
    && !connectionDraft.accountStatus.requiresCodeInput,
  );

  return {
    connectionProvider,
    refreshLocalSettings,
    openProviderConnection,
    updateConnectionDraft,
    connectionNeedsApiKey,
    connectionNeedsBaseUrl,
    connectionHasFreshTest,
    connectionAccountConnected,
    connectionDevicePending,
  };
};
