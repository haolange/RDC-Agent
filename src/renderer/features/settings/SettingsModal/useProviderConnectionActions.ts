import { getErrorMessage } from './utils';
import { connectionFailureText, createProviderConnectionDraft } from './providerConnectionState';
import {
  hasProviderConnectionDefinitionChanged,
  projectProviderModelPreferences,
  providerConnectionRequest,
  testedConnectionPatch,
} from './providerConnectionRequest';
import type { Dispatch, SetStateAction } from 'react';
import type { LlmProviderEntry, ProviderDefinitionSaveResult } from '@shared/types/settings';
import type { useI18n } from '../../../i18n';
import type { ProviderConnectionDraft } from './types';
import type { useProviderConnectionDraft } from './useProviderConnectionDraft';

type Translate = ReturnType<typeof useI18n>['t'];
type DraftApi = Pick<
  ReturnType<typeof useProviderConnectionDraft>,
  'connectionProvider' | 'refreshLocalSettings' | 'updateConnectionDraft'
>;

export const useProviderConnectionActions = (
  connectionDraft: ProviderConnectionDraft | null,
  setConnectionDraft: Dispatch<SetStateAction<ProviderConnectionDraft | null>>,
  providerDrafts: LlmProviderEntry[],
  saveProvider: (provider: LlmProviderEntry) => Promise<ProviderDefinitionSaveResult>,
  draftApi: DraftApi,
  t: Translate,
) => {
  const { connectionProvider, refreshLocalSettings, updateConnectionDraft } = draftApi;

  const modelPreferences = () => projectProviderModelPreferences(connectionDraft);

  /** After a successful save or sign-in the detail stays on the provider, re-read from saved settings. */
  const reopenSaved = async (providerId: string): Promise<void> => {
    const settings = await refreshLocalSettings(providerId);
    const saved = settings.llm.providers.find((entry) => entry.id === providerId);
    setConnectionDraft(saved ? createProviderConnectionDraft(saved) : null);
  };

  const saveModelPreferences = async (): Promise<void> => {
    if (!connectionDraft) return;
    const provider = providerDrafts.find((entry) => entry.id === connectionDraft.providerId);
    if (!provider) throw new Error(`Provider ${connectionDraft.providerId} is unavailable.`);
    const result = await saveProvider({
      ...provider,
      models: connectionDraft.models.map((model) => ({ ...model })),
    });
    if (result.status === 'failed') throw new Error(result.error ?? t('settings.providerSaveFailed'));
    if (result.status === 'superseded') return;
    await reopenSaved(connectionDraft.providerId);
  };

  const handleTestProviderDraft = async () => {
    if (!connectionDraft) return;
    updateConnectionDraft({ busy: 'testing', error: '', discoveryDiagnostic: null });
    try {
      if (connectionDraft.authMode === 'account') {
        const result = await window.electronAPI.llm.refreshProviderModels(connectionDraft.providerId);
        if (!result.success) {
          updateConnectionDraft({ busy: 'idle', error: connectionFailureText(result, t, 'settings.providerTestFailed') });
          return;
        }
        updateConnectionDraft({
          ...testedConnectionPatch(connectionDraft, result),
          accountStatus: await window.electronAPI.llm.getProviderAccountStatus(connectionDraft.providerId),
        });
        await refreshLocalSettings(connectionDraft.providerId);
        return;
      }
      const request = providerConnectionRequest(connectionDraft) as Parameters<typeof window.electronAPI.llm.testProviderDraft>[0]
        & { protocol?: typeof connectionDraft.protocol };
      const result = await window.electronAPI.llm.testProviderDraft(request);
      if (!result.success) {
        updateConnectionDraft({ busy: 'idle', error: connectionFailureText(result, t, 'settings.providerTestFailed') });
        return;
      }
      updateConnectionDraft(testedConnectionPatch(connectionDraft, result));
    } catch (error) {
      updateConnectionDraft({
        busy: 'idle',
        error: getErrorMessage(error, t('settings.providerTestFailed')),
      });
    }
  };

  const handleSaveProviderConnection = async () => {
    if (!connectionDraft) return;
    updateConnectionDraft({ busy: 'saving', error: '', discoveryDiagnostic: null });
    try {
      if (connectionDraft.authMode === 'account') {
        if (connectionProvider?.isConfigured && !connectionDraft.accountStatus?.requiresCodeInput) {
          await saveModelPreferences();
          return;
        }
        const status = connectionDraft.accountStatus?.requiresCodeInput
          ? await window.electronAPI.llm.finishProviderAccountLogin({
            providerId: connectionDraft.providerId,
            code: connectionDraft.authCode,
          })
          : await window.electronAPI.llm.startProviderAccountLogin({
            providerId: connectionDraft.providerId,
            authMode: connectionDraft.authMode,
          });
        if (!status.connected && status.state !== 'pending') {
          updateConnectionDraft({ busy: 'idle', error: '', accountStatus: status });
          return;
        }
        if (status.connected) {
          await reopenSaved(connectionDraft.providerId);
          return;
        }
        updateConnectionDraft({ busy: 'idle', error: '', accountStatus: status });
        return;
      }
      const storedProvider = providerDrafts.find((provider) => provider.id === connectionDraft.providerId);
      const connectionDefinitionChanged = hasProviderConnectionDefinitionChanged(storedProvider, connectionDraft);
      if (connectionProvider?.isConfigured && !connectionDefinitionChanged) {
        await saveModelPreferences();
        return;
      }
      const request = {
        ...providerConnectionRequest(connectionDraft),
        modelPreferences: modelPreferences(),
      } as Parameters<typeof window.electronAPI.llm.connectProvider>[0] & { protocol?: typeof connectionDraft.protocol };
      const result = await window.electronAPI.llm.connectProvider(request);
      if (!result.success) {
        updateConnectionDraft({ busy: 'idle', error: connectionFailureText(result, t, 'settings.providerSaveFailed'), models: [] });
        return;
      }
      await reopenSaved(connectionDraft.providerId);
    } catch (error) {
      updateConnectionDraft({
        busy: 'idle',
        error: getErrorMessage(error, t('settings.providerSaveFailed')),
      });
    }
  };

  const handleStartAccountLogin = async () => {
    if (!connectionDraft) return;
    updateConnectionDraft({ busy: 'saving', error: '' });
    try {
      const status = await window.electronAPI.llm.startProviderAccountLogin({
        providerId: connectionDraft.providerId,
        authMode: connectionDraft.authMode,
      });
      updateConnectionDraft({
        busy: 'idle',
        error: '',
        accountStatus: status,
      });
      if (status.connected) {
        await reopenSaved(connectionDraft.providerId);
      }
    } catch (error) {
      updateConnectionDraft({
        busy: 'idle',
        error: getErrorMessage(error, t('settings.providerSaveFailed')),
      });
    }
  };

  return {
    handleTestProviderDraft,
    handleSaveProviderConnection,
    handleStartAccountLogin,
  };
};
