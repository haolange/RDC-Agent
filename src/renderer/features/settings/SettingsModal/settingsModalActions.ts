import type {
  AppSettings,
  AppSettingsPatch,
  LlmProviderEntry,
} from '@shared/types/settings';
import type {
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
  AgentManifestDraft,
} from '@shared/types/agentManifest';
import type { useI18n } from '../../../i18n';
import { nextAgentDefinitionClientRevision } from '../../../stores/appSettingsStore';
import type { useProviderConnection } from './useProviderConnection';
import type { useSettingsModalState } from './useSettingsModalState';
import { cloneRoute, getErrorMessage } from './utils';

type Translate = ReturnType<typeof useI18n>['t'];
type ModalState = ReturnType<typeof useSettingsModalState>;
type ProviderConnection = ReturnType<typeof useProviderConnection>;

interface SettingsModalActionsOptions {
  modalState: ModalState;
  providerConnection: ProviderConnection;
  updateProfile: (profile: Partial<AppSettings['profile']>) => Promise<void>;
  patchSettings: (patch: AppSettingsPatch) => Promise<AppSettings>;
  saveAgentDefinition: (request: AgentDefinitionSaveRequest) => Promise<AgentDefinitionSaveResult>;
  t: Translate;
}

export interface AgentManifestSaveBatch {
  drafts: AgentManifestDraft[];
  clientRevision: number;
}

export function createSettingsModalActions({
  modalState,
  providerConnection,
  updateProfile,
  patchSettings,
  saveAgentDefinition,
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

  const handleSaveAgentManifests = async (
    batch?: AgentManifestSaveBatch,
  ): Promise<AgentDefinitionSaveResult[] | null> => {
    const request = batch ?? {
      drafts: modalState.agentManifestDrafts,
      clientRevision: nextAgentDefinitionClientRevision(),
    };
    const saveBatch = () => Promise.all(request.drafts.map((draft) => saveAgentDefinition({
      draft,
      clientRevision: request.clientRevision,
    })));
    if (batch) return saveBatch();

    modalState.setAgentManifestSaveState('saving');
    modalState.setAgentManifestSaveMessage('');
    try {
      const results = await saveBatch();
      modalState.setAgentManifestSaveState('saved');
      modalState.setAgentManifestSaveMessage(t('settings.agentManifestSaved'));
      return results;
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
    handleSaveAgentManifests,
    handleImportAgentManifest,
    handleSaveToolsConfig,
    handleSavePersonalization,
  };
}
