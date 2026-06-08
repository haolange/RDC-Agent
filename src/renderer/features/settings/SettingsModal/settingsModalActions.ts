import type {
  AppSettings,
  AppSettingsPatch,
  LlmAgentRoute,
  LlmProviderEntry,
} from '@shared/types/settings';
import { AGENT_ROLES } from '@shared/constants/agents';
import type { TranslationKey, useI18n } from '../../../i18n';
import type { useProviderConnection } from './useProviderConnection';
import type { useSettingsModalState } from './useSettingsModalState';
import { cloneRoute, getErrorMessage } from './utils';

type Translate = ReturnType<typeof useI18n>['t'];
type ModalState = ReturnType<typeof useSettingsModalState>;
type ProviderConnection = ReturnType<typeof useProviderConnection>;

interface SettingsModalActionsOptions {
  settings: AppSettings;
  modalState: ModalState;
  providerConnection: ProviderConnection;
  invalidAgentRoutes: Array<{ agentId: LlmAgentRoute['agentId']; issue: TranslationKey }>;
  invalidAgentRouteMessage: string;
  updateProfile: (profile: Partial<AppSettings['profile']>) => Promise<void>;
  updateWorkspaceRoot: (rootPath: string) => Promise<void>;
  resetWorkspaceRoot: () => Promise<void>;
  patchSettings: (patch: AppSettingsPatch) => Promise<AppSettings>;
  reloadSettings: () => Promise<AppSettings>;
  t: Translate;
}

export function createSettingsModalActions({
  settings,
  modalState,
  providerConnection,
  invalidAgentRoutes,
  invalidAgentRouteMessage,
  updateProfile,
  updateWorkspaceRoot,
  resetWorkspaceRoot,
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

  const handleWorkspacePick = async () => {
    const nextRoot = await window.electronAPI?.selectDirectory();
    if (nextRoot) {
      modalState.setWorkspaceDraft(nextRoot);
    }
  };

  const handleWorkspaceSave = async () => {
    await updateWorkspaceRoot(modalState.workspaceDraft.trim() || settings.paths.defaultWorkspaceRoot);
  };

  const handleWorkspaceReset = async () => {
    modalState.setWorkspaceDraft(settings.paths.defaultWorkspaceRoot);
    await resetWorkspaceRoot();
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
      await patchSettings({
        llm: {
          agentRoutes: AGENT_ROLES.map((agentId) => {
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

  const handleSaveAgentRuntimeConfig = async () => {
    await patchSettings({
      tooling: {
        rdxCli: modalState.rdxCliDraft,
      },
      configuration: {
        activeModeProfileId: modalState.activeModeProfileDraft,
        enabledSkillIds: modalState.enabledSkillDrafts,
        enabledMcpServerIds: modalState.enabledMcpDrafts,
        modePatternBindings: modalState.patternBindingDrafts,
      },
    });
  };

  const toggleRuntimeId = (values: string[], id: string): string[] =>
    values.includes(id) ? values.filter((value) => value !== id) : [...values, id];

  return {
    handleAvatarSelect,
    handleAccountSave,
    handleWorkspacePick,
    handleWorkspaceSave,
    handleWorkspaceReset,
    handleRefreshProviderModels,
    handleDisconnectProvider,
    handleRouteChange,
    handleSaveAgentRoutes,
    handleSaveAgentRuntimeConfig,
    toggleRuntimeId,
  };
}
