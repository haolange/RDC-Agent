import type {
  AgentRuntimeMcpWriteRequest,
  AgentRuntimeSkillWriteRequest,
} from '@shared/types/agentRuntime';
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

  const handleSaveAgentRuntimeConfig = async () => {
    await patchSettings({
      tooling: {
        rdxCli: modalState.rdxCliDraft,
        rdxActions: modalState.rdxActionsDraft,
      },
      configuration: {
        activeModeProfileId: modalState.activeModeProfileDraft,
        enabledMcpServerIds: modalState.enabledMcpDrafts,
        modePatternBindings: modalState.patternBindingDrafts,
      },
    });
  };

  const handleSaveToolsConfig = async () => {
    const nextSettings = await patchSettings({
      tooling: {
        rdxCli: modalState.rdxCliDraft,
        rdxActions: modalState.rdxActionsDraft,
      },
      configuration: {
        enabledMcpServerIds: modalState.enabledMcpDrafts,
      },
    });
    modalState.setRdxCliDraft(nextSettings.tooling.rdxCli);
    modalState.setRdxActionsDraft(nextSettings.tooling.rdxActions);
    modalState.setEnabledMcpDrafts(nextSettings.configuration.enabledMcpServerIds);
  };

  const handleSavePersonalization = async () => {
    const nextSettings = await patchSettings({
      agents: {
        globalInstructions: modalState.globalInstructionsDraft,
      },
    });
    modalState.setGlobalInstructionsDraft(nextSettings.agents.globalInstructions);
  };

  const refreshRuntimeCatalog = async () => {
    const nextSettings = await reloadSettings();
    modalState.setEnabledMcpDrafts(nextSettings.configuration.enabledMcpServerIds);
    return nextSettings;
  };

  const handleUpsertSkill = async (request: AgentRuntimeSkillWriteRequest) => {
    await window.electronAPI.settings.upsertSkill(request);
    return refreshRuntimeCatalog();
  };

  const handleDeleteSkill = async (skillId: string) => {
    await window.electronAPI.settings.deleteSkill(skillId);
    return refreshRuntimeCatalog();
  };

  const handleImportSkill = async () => {
    const filePaths = await window.electronAPI?.selectFiles();
    const filePath = filePaths?.find((entry) => entry.endsWith('.md'));
    if (!filePath) {
      throw new Error(t('settings.skillImportRequiresMarkdown'));
    }
    await window.electronAPI.settings.importSkill(filePath);
    return refreshRuntimeCatalog();
  };

  const handleUpsertMcpServer = async (request: AgentRuntimeMcpWriteRequest) => {
    await window.electronAPI.settings.upsertMcpServer(request);
    return refreshRuntimeCatalog();
  };

  const handleDeleteMcpServer = async (serverId: string) => {
    await window.electronAPI.settings.deleteMcpServer(serverId);
    await patchSettings({
      configuration: {
        enabledMcpServerIds: modalState.enabledMcpDrafts.filter((id) => id !== serverId),
      },
    });
    return refreshRuntimeCatalog();
  };

  const handleImportMcpServer = async () => {
    const filePaths = await window.electronAPI?.selectFiles();
    const filePath = filePaths?.find((entry) => entry.endsWith('.json'));
    if (!filePath) {
      throw new Error(t('settings.mcpImportRequiresJson'));
    }
    await window.electronAPI.settings.importMcpServer(filePath);
    return refreshRuntimeCatalog();
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
    handleSaveAgentManifests,
    handleImportAgentManifest,
    handleSaveAgentRuntimeConfig,
    handleSaveToolsConfig,
    handleSavePersonalization,
    handleUpsertSkill,
    handleDeleteSkill,
    handleImportSkill,
    handleUpsertMcpServer,
    handleDeleteMcpServer,
    handleImportMcpServer,
    toggleRuntimeId,
  };
}
