import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { RevisionLanes } from '../../../lib/revisionLanes';
import {
  createProviderConnectionDraft,
  getConnectionDraftSignature,
  isConnectionDraftComplete,
  projectConnectionProvider,
} from './providerConnectionState';
import { cloneProvider } from './utils';
import type { AppSettings, LlmProviderEntry } from '@shared/types/settings';
import type { useI18n } from '../../../i18n';
import type { ProviderConnectionDraft } from './types';

type Translate = ReturnType<typeof useI18n>['t'];

export interface UseProviderConnectionDraftOptions {
  open: boolean;
  providerDrafts: LlmProviderEntry[];
  setProviderDrafts: Dispatch<SetStateAction<LlmProviderEntry[]>>;
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
  selectedProviderId,
  setSelectedProviderId,
  connectionDraft,
  setConnectionDraft,
  reloadSettings,
  t,
}: UseProviderConnectionDraftOptions) => {
  const [accountPolls] = useState(() => new RevisionLanes());
  const connectionProvider = useMemo(() => {
    const provider = providerDrafts.find((entry) => entry.id === connectionDraft?.providerId) ?? null;
    return projectConnectionProvider(provider, connectionDraft);
  }, [connectionDraft, providerDrafts]);

  const refreshLocalSettings = async (preferredProviderId?: string) => {
    const nextSettings = await reloadSettings();
    const nextProviders = nextSettings.llm.providers.map(cloneProvider);
    setProviderDrafts(nextProviders);
    setSelectedProviderId(
      preferredProviderId && nextProviders.some((provider) => provider.id === preferredProviderId)
        ? preferredProviderId
        : selectedProviderId && nextProviders.some((provider) => provider.id === selectedProviderId)
          ? selectedProviderId
          : (nextProviders[0]?.id ?? null),
    );
    return nextSettings;
  };

  useEffect(() => {
    if (
      !open ||
      !connectionDraft ||
      connectionProvider?.authMode !== 'account' ||
      connectionDraft.accountStatus?.state !== 'pending'
    ) {
      return;
    }

    // Each sign-in wait is one revision of the poll lane; a poll answering after the wait ended changes nothing.
    const poll = accountPolls.begin('status');
    const current = () => accountPolls.isLatest('status', poll);
    const timer = window.setInterval(() => {
      void (async () => {
        const status = await window.electronAPI.llm.getProviderAccountStatus(connectionDraft.providerId);
        if (!current()) return;
        if (status.connected) {
          const nextSettings = await reloadSettings();
          if (!current()) return;
          const nextProviders = nextSettings.llm.providers.map(cloneProvider);
          setProviderDrafts(nextProviders);
          setSelectedProviderId(
            nextProviders.some((provider) => provider.id === connectionDraft.providerId)
              ? connectionDraft.providerId
              : (nextProviders[0]?.id ?? null),
          );
          setConnectionDraft(null);
          return;
        }
        if (status.state === 'failed' || status.state === 'unavailable') {
          setConnectionDraft((current) =>
            current && current.providerId === connectionDraft.providerId
              ? {
                  ...current,
                  busy: 'idle',
                  accountStatus: status,
                  error: status.error ?? status.message ?? t('settings.providerSaveFailed'),
                }
              : current,
          );
          return;
        }
        setConnectionDraft((current) =>
          current && current.providerId === connectionDraft.providerId
            ? { ...current, accountStatus: status, error: '' }
            : current,
        );
      })();
    }, 1200);

    return () => {
      accountPolls.forget('status');
      window.clearInterval(timer);
    };
  }, [
    accountPolls,
    connectionDraft,
    connectionProvider?.authMode,
    open,
    reloadSettings,
    setConnectionDraft,
    setProviderDrafts,
    setSelectedProviderId,
    t,
  ]);

  const loginOwner = open && connectionDraft ? connectionDraft.providerId : null;
  useEffect(
    () => () => {
      if (loginOwner) {
        void window.electronAPI.llm
          .cancelProviderAccountLogin(loginOwner)
          .catch((error: unknown) => console.warn('[settings] could not cancel the account login', error));
      }
    },
    [loginOwner],
  );

  const openProviderConnection = (provider: LlmProviderEntry) => {
    setConnectionDraft(createProviderConnectionDraft(provider));
  };

  const updateConnectionDraft = (patch: Partial<ProviderConnectionDraft>) => {
    setConnectionDraft((current) =>
      current && current.providerId === connectionDraft?.providerId ? { ...current, ...patch } : current,
    );
  };

  const connectionNeedsCredentials = Boolean(
    connectionDraft &&
    connectionProvider?.authMode === 'api-key' &&
    !isConnectionDraftComplete(connectionProvider, connectionDraft),
  );
  const connectionNeedsBaseUrl = Boolean(
    connectionDraft &&
    connectionProvider?.baseUrlEditable &&
    !connectionProvider.connectionSchema?.endpointTemplate &&
    !connectionDraft.baseUrl.trim(),
  );
  const connectionHasFreshTest = Boolean(
    connectionDraft &&
    connectionDraft.models.length > 0 &&
    connectionDraft.testedConnectionSignature === getConnectionDraftSignature(connectionDraft),
  );
  const connectionAccountConnected = Boolean(
    connectionDraft &&
    connectionProvider?.authMode === 'account' &&
    connectionProvider.isConfigured &&
    connectionDraft.accountStatus?.connected,
  );
  const connectionDevicePending = Boolean(
    connectionDraft &&
    connectionProvider?.authMode === 'account' &&
    connectionDraft.accountStatus?.state === 'pending' &&
    !connectionDraft.accountStatus.requiresCodeInput,
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
