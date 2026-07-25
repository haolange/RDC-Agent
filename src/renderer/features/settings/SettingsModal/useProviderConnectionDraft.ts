import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { AppSettings, LlmAgentRoute, LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../i18n';
import type { ProviderConnectionDraft } from './types';
import {
  createProviderConnectionDraft,
  getConnectionDraftSignature,
  isConnectionDraftComplete,
  projectConnectionProvider,
} from './providerConnectionState';
import { cloneProvider, cloneRoute } from './utils';

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
  const connectionProvider = useMemo(() => {
    const provider = providerDrafts.find((entry) => entry.id === connectionDraft?.providerId) ?? null;
    return projectConnectionProvider(provider, connectionDraft);
  }, [connectionDraft, providerDrafts]);

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
    connectionDraft,
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
    setConnectionDraft(createProviderConnectionDraft(provider));
  };

  const updateConnectionDraft = (patch: Partial<ProviderConnectionDraft>) => {
    setConnectionDraft((current) => current ? { ...current, ...patch } : current);
  };

  const connectionNeedsCredentials = Boolean(
    connectionDraft
    && connectionProvider?.authMode === 'api-key'
    && !isConnectionDraftComplete(connectionProvider, connectionDraft),
  );
  const connectionNeedsBaseUrl = Boolean(
    connectionDraft
    && connectionProvider?.baseUrlEditable
    && !connectionProvider.connectionSchema?.endpointTemplate
    && !connectionDraft.baseUrl.trim(),
  );
  const connectionHasFreshTest = Boolean(
    connectionDraft
    && connectionDraft.models.length > 0
    && connectionDraft.testedConnectionSignature === getConnectionDraftSignature(connectionDraft),
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
    connectionNeedsCredentials,
    connectionNeedsBaseUrl,
    connectionHasFreshTest,
    connectionAccountConnected,
    connectionDevicePending,
  };
};
