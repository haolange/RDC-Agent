import type { Dispatch, SetStateAction } from 'react';
import type { LlmProviderEntry, ProviderDefinitionSaveResult } from '@shared/types/settings';
import type { useI18n } from '../../../i18n';
import type { ProviderConnectionDraft } from './types';
import { getErrorMessage } from './utils';
import type { useProviderConnectionDraft } from './useProviderConnectionDraft';
import {
  getConnectionDraftSignature,
  getConnectionRequestValues,
} from './providerConnectionState';
import {
  hasProviderConnectionDefinitionChanged,
  projectProviderModelPreferences,
} from './providerConnectionRequest';

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

  const saveModelPreferences = async (): Promise<void> => {
    if (!connectionDraft) return;
    const provider = providerDrafts.find((entry) => entry.id === connectionDraft.providerId);
    if (!provider) throw new Error(`Provider ${connectionDraft.providerId} is unavailable.`);
    await saveProvider({
      ...provider,
      models: connectionDraft.models.map((model) => ({ ...model })),
    });
    await refreshLocalSettings(connectionDraft.providerId);
    setConnectionDraft(null);
  };

  const handleTestProviderDraft = async () => {
    if (!connectionDraft) return;
    updateConnectionDraft({ busy: 'testing', error: '', discoveryDiagnostic: null });
    try {
      if (connectionDraft.authMode === 'account') {
        const result = await window.electronAPI.llm.refreshProviderModels(connectionDraft.providerId);
        if (!result.success) {
          updateConnectionDraft({ busy: 'idle', error: result.error ?? t('settings.providerTestFailed') });
          return;
        }
        updateConnectionDraft({
          busy: 'idle',
          error: '',
          discoveryDiagnostic: result.discoveryDiagnostic ?? null,
          testedApiKey: connectionDraft.apiKey,
          testedBaseUrl: connectionDraft.baseUrl,
          testedProtocol: connectionDraft.protocol,
          testedAuthMode: connectionDraft.authMode,
          testedConnectionSignature: getConnectionDraftSignature(connectionDraft),
          models: result.models,
        });
        await refreshLocalSettings(connectionDraft.providerId);
        return;
      }
      const request = {
        providerId: connectionDraft.providerId,
        authMode: connectionDraft.authMode,
        apiKey: connectionDraft.usingStoredSecret ? '' : connectionDraft.apiKey,
        baseUrl: connectionDraft.baseUrl,
        protocol: connectionDraft.protocol,
        connectionValues: getConnectionRequestValues(connectionDraft),
      } as Parameters<typeof window.electronAPI.llm.testProviderDraft>[0] & { protocol?: typeof connectionDraft.protocol };
      const result = await window.electronAPI.llm.testProviderDraft(request);
      if (!result.success) {
        updateConnectionDraft({ busy: 'idle', error: result.error ?? t('settings.providerTestFailed') });
        return;
      }
      updateConnectionDraft({
        busy: 'idle',
        error: '',
        discoveryDiagnostic: result.discoveryDiagnostic ?? null,
        testedApiKey: connectionDraft.apiKey,
        testedBaseUrl: connectionDraft.baseUrl,
        testedProtocol: connectionDraft.protocol,
        testedAuthMode: connectionDraft.authMode,
        testedConnectionSignature: getConnectionDraftSignature(connectionDraft),
        models: result.models,
      });
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
            accountLoginMode: connectionDraft.accountLoginMode,
          });
        if (!status.connected && status.state !== 'pending') {
          updateConnectionDraft({ busy: 'idle', error: '', accountStatus: status });
          return;
        }
        if (status.connected) {
          await refreshLocalSettings(connectionDraft.providerId);
          setConnectionDraft(null);
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
        providerId: connectionDraft.providerId,
        authMode: connectionDraft.authMode,
        apiKey: connectionDraft.usingStoredSecret ? '' : connectionDraft.apiKey,
        baseUrl: connectionDraft.baseUrl,
        protocol: connectionDraft.protocol,
        connectionValues: getConnectionRequestValues(connectionDraft),
        modelPreferences: modelPreferences(),
      } as Parameters<typeof window.electronAPI.llm.connectProvider>[0] & { protocol?: typeof connectionDraft.protocol };
      const result = await window.electronAPI.llm.connectProvider(request);
      if (!result.success) {
        updateConnectionDraft({ busy: 'idle', error: result.error ?? t('settings.providerSaveFailed'), models: [] });
        return;
      }
      await refreshLocalSettings(connectionDraft.providerId);
      setConnectionDraft(null);
    } catch (error) {
      updateConnectionDraft({
        busy: 'idle',
        error: getErrorMessage(error, t('settings.providerSaveFailed')),
      });
    }
  };

  const handleStartAccountLogin = async (accountLoginMode = connectionDraft?.accountLoginMode) => {
    if (!connectionDraft) return;
    updateConnectionDraft({ busy: 'saving', error: '' });
    try {
      const status = await window.electronAPI.llm.startProviderAccountLogin({
        providerId: connectionDraft.providerId,
        authMode: connectionDraft.authMode,
        accountLoginMode,
      });
      updateConnectionDraft({
        busy: 'idle',
        error: '',
        accountStatus: status,
      });
      if (status.connected) {
        await refreshLocalSettings(connectionDraft.providerId);
        setConnectionDraft(null);
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
