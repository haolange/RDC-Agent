import type {
  AppSettings,
  AppSettingsPatch,
  LlmAgentRoute,
  LlmProviderEntry,
} from '@shared/types/settings';
import type { TranslationKey, useI18n } from '../../../i18n';
import type { useProviderConnection } from './useProviderConnection';
import type { useSettingsModalState } from './useSettingsModalState';
import { cloneRoute, getErrorMessage } from './utils';

type Translate = ReturnType<typeof useI18n>['t'];
type ModalState = ReturnType<typeof useSettingsModalState>;
type ProviderConnection = ReturnType<typeof useProviderConnection>;

interface SettingsModalActionsOptions {
  modalState: ModalState;
  providerConnection: ProviderConnection;
  invalidAgentRoutes: Array<{ agentId: LlmAgentRoute['agentId']; issue: TranslationKey }>;
  invalidAgentRouteMessage: string;
  updateProfile: (profile: Partial<AppSettings['profile']>) => Promise<void>;
  patchSettings: (patch: AppSettingsPatch) => Promise<AppSettings>;
  reloadSettings: () => Promise<AppSettings>;
  t: Translate;
}

export function createSettingsModalActions({
  modalState,
  providerConnection,
  invalidAgentRoutes,
  invalidAgentRouteMessage,
  updateProfile,
  patchSettings,
  reloadSettings,
  t,
}: SettingsModalActionsOptions) {
  const handleAvatarSelect = async () => {
    const avatarPath = await window.electronAPI?.appShell.selectAvatar();
    if (!avatarPath) return;
    modalState.setAccountDraft((current) => ({ ...current, avatarPath }));
  };

  const handleAccountSave = async () => {
    await updateProfile(modalState.accountDraft);
  };

  const handleRefreshProviderModels = async (provider: LlmProviderEntry) => {
    modalState.setProviderDrafts((current) => current.map((entry) => (
      entry.id === provider.id ? { ...entry, status: 'unconfigured', lastError: '' } : entry
    )));
    try {
      const result = await window.electronAPI.llm.refreshProviderModels(provider.id);
      if (!result.success) {
        modalState.setProviderDrafts((current) => current.map((entry) => (
          entry.id === provider.id ? { ...entry, status: 'failed', lastError: result.error } : entry
        )));
        return;
      }
      await providerConnection.refreshLocalSettings(provider.id);
    } catch (error) {
      modalState.setProviderDrafts((current) => current.map((entry) => (
        entry.id === provider.id ? { ...entry, status: 'failed', lastError: getErrorMessage(error, t('settings.providerTestFailed')) } : entry
      )));
    }
  };

  const handleDisconnectProvider = async (provider: LlmProviderEntry) => {
    try {
      if (provider.authMode === 'account') {
        const status = await window.electronAPI.llm.logoutProviderAccount(provider.id);
        if (status.error) {
          modalState.setProviderDrafts((current) => current.map((entry) => (
            entry.id === provider.id ? { ...entry, status: 'failed', lastError: status.error } : entry
          )));
          return;
        }
        await providerConnection.refreshLocalSettings(provider.id);
        return;
      }
      const result = await window.electronAPI.llm.disconnectProvider(provider.id);
      if (!result.success) {
        modalState.setProviderDrafts((current) => current.map((entry) => (
          entry.id === provider.id ? { ...entry, status: 'failed', lastError: result.error } : entry
        )));
        return;
      }
      await providerConnection.refreshLocalSettings(provider.id);
    } catch (error) {
      modalState.setProviderDrafts((current) => current.map((entry) => (
        entry.id === provider.id ? { ...entry, status: 'failed', lastError: getErrorMessage(error, t('settings.providerSaveFailed')) } : entry
      )));
    }
  };

  const handleRouteChange = (agentId: LlmAgentRoute['agentId'], patch: Partial<LlmAgentRoute>) => {
    modalState.setAgentRouteSaveState('idle');
    modalState.setAgentRouteSaveMessage('');
    modalState.setAgentRouteDrafts((current) => {
      if (!current.some((route) => route.agentId === agentId)) {
        return [...current, { agentId, providerId: '', modelId: '', ...patch }];
      }
      return current.map((route) => (
        route.agentId === agentId ? { ...route, ...patch } : route
      ));
    });
  };

  const handleSaveAgentRoutes = async () => {
    if (invalidAgentRoutes.length > 0) {
      modalState.setAgentRouteSaveState('error');
      modalState.setAgentRouteSaveMessage(invalidAgentRouteMessage);
      return;
    }

    modalState.setAgentRouteSaveState('saving');
    modalState.setAgentRouteSaveMessage('');
    try {
      const agentIds = Array.from(new Set(
        modalState.agentManifestDrafts
          .filter((agent) => !agent.delete)
          .map((agent) => agent.id.trim())
          .filter(Boolean),
      ));
      await patchSettings({
        llm: {
          agentRoutes: agentIds.map((agentId) => {
            const route = modalState.agentRouteDrafts.find((entry) => entry.agentId === agentId);
            return route ?? { agentId, providerId: '', modelId: '' };
          }),
        },
      });
      const nextSettings = await reloadSettings();
      modalState.setAgentRouteDrafts(nextSettings.llm.agentRoutes.map(cloneRoute));
      modalState.setAgentRouteSaveState('saved');
      modalState.setAgentRouteSaveMessage(t('settings.agentRouteSaved'));
    } catch (error) {
      modalState.setAgentRouteSaveState('error');
      modalState.setAgentRouteSaveMessage(getErrorMessage(error, t('settings.agentRouteSaveFailed')));
    }
  };

  const handleSaveAgentManifests = async (): Promise<AppSettings | null> => {
    modalState.setAgentManifestSaveState('saving');
    modalState.setAgentManifestSaveMessage('');
    try {
      await patchSettings({
        agents: {
          definitions: modalState.agentManifestDrafts,
        },
      });
      const nextSettings = await reloadSettings();
      modalState.setAgentManifestDrafts(nextSettings.agents.definitions.map((definition) => ({ ...definition })));
      modalState.setAgentRouteDrafts(nextSettings.llm.agentRoutes.map(cloneRoute));
      modalState.setAgentManifestSaveState('saved');
      modalState.setAgentManifestSaveMessage(t('settings.agentManifestSaved'));
      return nextSettings;
    } catch (error) {
      modalState.setAgentManifestSaveState('error');
      modalState.setAgentManifestSaveMessage(getErrorMessage(error, t('settings.agentManifestSaveFailed')));
      return null;
    }
  };

  const handleImportAgentManifest = async () => {
    const filePaths = await window.electronAPI?.selectFiles();
    const filePath = filePaths?.find((entry) => entry.endsWith('.agent.md'));
    if (!filePath) {
      modalState.setAgentManifestSaveState('error');
      modalState.setAgentManifestSaveMessage(t('settings.agentImportRequiresManifest'));
      return;
    }
    modalState.setAgentManifestSaveState('saving');
    modalState.setAgentManifestSaveMessage('');
    try {
      const nextSettings = await window.electronAPI.settings.importAgentManifest(filePath);
      modalState.setAgentManifestDrafts(nextSettings.agents.definitions.map((definition) => ({ ...definition })));
      modalState.setAgentRouteDrafts(nextSettings.llm.agentRoutes.map(cloneRoute));
      modalState.setAgentManifestSaveState('saved');
      modalState.setAgentManifestSaveMessage(t('settings.agentManifestImported'));
    } catch (error) {
      modalState.setAgentManifestSaveState('error');
      modalState.setAgentManifestSaveMessage(getErrorMessage(error, t('settings.agentManifestSaveFailed')));
    }
  };

  const handleSaveToolsConfig = async () => {
    const nextSettings = await patchSettings({
      tooling: {
        rdxCli: modalState.rdxCliDraft,
        rdxActions: modalState.rdxActionsDraft,
      },
    });
    modalState.setRdxCliDraft(nextSettings.tooling.rdxCli);
    modalState.setRdxActionsDraft(nextSettings.tooling.rdxActions);
  };

  const handleSavePersonalization = async () => {
    const nextSettings = await patchSettings({
      agents: {
        globalInstructions: modalState.globalInstructionsDraft,
      },
    });
    modalState.setGlobalInstructionsDraft(nextSettings.agents.globalInstructions);
  };

  return {
    handleAvatarSelect,
    handleAccountSave,
    handleRefreshProviderModels,
    handleDisconnectProvider,
    handleRouteChange,
    handleSaveAgentRoutes,
    handleSaveAgentManifests,
    handleImportAgentManifest,
    handleSaveToolsConfig,
    handleSavePersonalization,
  };
}
