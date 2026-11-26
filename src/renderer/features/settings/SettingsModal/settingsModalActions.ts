import { resolveAgentWriteTargetFromDraft, toAgentManifestEditorDraft } from '@shared/types/agentManifest';
import { applyAgentDefinitionSaveResults, selectSubmittableAgentManifestDrafts } from './agentManifestAutosaveState';
import { getErrorMessage } from './utils';
import type { AppSettings, LlmProviderEntry, SettingsPatchOp, SettingsView } from '@shared/types/settings';
import type {
  AgentDefinitionSaveRequest,
  AgentDefinitionSaveResult,
  AgentManifestDefinition,
  AgentManifestDraft,
  AgentOverrideFileRequest,
} from '@shared/types/agentManifest';
import type { useI18n } from '../../../i18n';
import type { useProviderConnection } from './useProviderConnection';
import type { useSettingsModalState } from './useSettingsModalState';

type Translate = ReturnType<typeof useI18n>['t'];
type ModalState = ReturnType<typeof useSettingsModalState>;
type ProviderConnection = ReturnType<typeof useProviderConnection>;

interface SettingsModalActionsOptions {
  modalState: ModalState;
  providerConnection: ProviderConnection;
  updateProfile: (profile: Partial<AppSettings['profile']>) => Promise<void>;
  patchSettings: (ops: SettingsPatchOp[]) => Promise<AppSettings>;
  saveAgentDefinition: (
    request: Omit<AgentDefinitionSaveRequest, 'clientRevision'>,
  ) => Promise<AgentDefinitionSaveResult>;
  currentProjectId?: string | null;
  t: Translate;
  blockSubmit?: (draft: AgentManifestDraft) => string | null;
  blockProjectedSubmit?: (projectedDrafts: AgentManifestDraft[]) => string | null;
  adoptView: (view: SettingsView) => void;
  /** Makes definitions main committed outside autosave the autosave baseline. */
  rebaseAgentDrafts: (definitions: AgentManifestDefinition[]) => void;
}

/** One autosave batch; each draft is saved on its own Agent file's revision lane. */
export interface AgentManifestSaveBatch {
  drafts: AgentManifestDraft[];
}

export function createSettingsModalActions({
  modalState,
  providerConnection,
  updateProfile,
  patchSettings,
  saveAgentDefinition,
  currentProjectId,
  t,
  blockSubmit,
  blockProjectedSubmit,
  adoptView,
  rebaseAgentDrafts,
}: SettingsModalActionsOptions) {
  /** Settings main committed outside autosave (import, override deletion, trust) become the store's view and the Agent drafts. */
  const adoptAgentSettings = (view: SettingsView) => {
    adoptView(view);
    rebaseAgentDrafts(view.agents.definitions);
    modalState.setAgentManifestDrafts(
      view.agents.definitions.map((definition) => toAgentManifestEditorDraft(definition, currentProjectId)),
    );
  };

  const handleAvatarSelect = async () => {
    const avatarPath = await window.electronAPI.appShell.selectAvatar();
    if (!avatarPath) return;
    modalState.setAccountDraft((current) => ({ ...current, avatarPath }));
  };

  const handleAccountSave = async () => {
    await updateProfile(modalState.accountDraft);
  };

  const handleDisconnectProvider = async (provider: LlmProviderEntry) => {
    try {
      if (provider.authMode === 'account') {
        const status = await window.electronAPI.llm.logoutProviderAccount(provider.id);
        if (status.error) {
          modalState.setProviderDrafts((current) =>
            current.map((entry) =>
              entry.id === provider.id ? { ...entry, status: 'failed', lastError: status.error } : entry,
            ),
          );
          return;
        }
        await providerConnection.refreshLocalSettings(provider.id);
        return;
      }
      const result = await window.electronAPI.llm.disconnectProvider(provider.id);
      if (!result.success) {
        modalState.setProviderDrafts((current) =>
          current.map((entry) =>
            entry.id === provider.id ? { ...entry, status: 'failed', lastError: result.error } : entry,
          ),
        );
        return;
      }
      await providerConnection.refreshLocalSettings(provider.id);
    } catch (error) {
      modalState.setProviderDrafts((current) =>
        current.map((entry) =>
          entry.id === provider.id
            ? { ...entry, status: 'failed', lastError: getErrorMessage(error, t('settings.providerSaveFailed')) }
            : entry,
        ),
      );
    }
  };

  const handleSaveAgentManifests = async (
    batch: AgentManifestSaveBatch,
  ): Promise<AgentDefinitionSaveResult[] | null> => {
    const { drafts, blockedReason } = selectSubmittableAgentManifestDrafts(
      batch.drafts,
      blockSubmit,
      blockProjectedSubmit,
      modalState.agentManifestDrafts,
    );
    if (blockedReason) throw new Error(blockedReason);
    if (drafts.length === 0) return [];
    const results = await Promise.all(
      drafts.map((draft) => {
        const write = resolveAgentWriteTargetFromDraft(draft, currentProjectId);
        return saveAgentDefinition({
          draft,
          scope: write.scope,
          projectId: write.projectId,
          sourceHash: draft.sourceHash,
        });
      }),
    );
    modalState.setAgentManifestDrafts((current) =>
      applyAgentDefinitionSaveResults(current, drafts, results, currentProjectId),
    );
    return results;
  };

  const handleImportAgentManifest = async () => {
    const filePaths = await window.electronAPI.selectFiles();
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
      adoptAgentSettings(nextSettings);
      modalState.setAgentManifestSaveState('saved');
      modalState.setAgentManifestSaveMessage(t('settings.agentManifestImported'));
    } catch (error) {
      modalState.setAgentManifestSaveState('error');
      modalState.setAgentManifestSaveMessage(getErrorMessage(error, t('settings.agentManifestSaveFailed')));
    }
  };

  /** Model choices live in Settings, so they commit immediately (one field per op) rather than through manifest autosave. */
  const handleAgentModelOps = async (ops: SettingsPatchOp[]): Promise<void> => {
    await patchSettings(ops);
  };

  const previewAgentOverrideFile = (sourcePath: string) =>
    window.electronAPI.settings.previewAgentOverrideFile(sourcePath);

  const handleDeleteAgentOverrideFile = async (request: AgentOverrideFileRequest): Promise<void> => {
    adoptAgentSettings(await window.electronAPI.settings.deleteAgentOverrideFile(request));
  };

  const previewProjectAgentTrust = (sourcePath: string) =>
    window.electronAPI.settings.previewProjectAgentTrust(sourcePath);

  const handleTrustProjectAgent = async (request: AgentOverrideFileRequest): Promise<void> => {
    adoptAgentSettings(await window.electronAPI.settings.trustProjectAgent(request));
  };

  const loadAgentBuiltinComparison = (draft: AgentManifestDraft) => {
    const write = resolveAgentWriteTargetFromDraft(draft, currentProjectId);
    return window.electronAPI.settings.getAgentBuiltinComparison({
      agentId: draft.id,
      scope: write.scope,
      ...(write.projectId ? { projectId: write.projectId } : {}),
    });
  };

  const handleSaveToolsConfig = async () => {
    const nextSettings = await patchSettings([
      {
        op: 'tooling',
        value: {
          rdcCli: modalState.rdcCliDraft,
          codeInterpreter: modalState.codeInterpreterDraft,
          shell: modalState.shellDraft,
        },
      },
    ]);
    modalState.setRdcCliDraft(nextSettings.tooling.rdcCli);
    modalState.setCodeInterpreterDraft(nextSettings.tooling.codeInterpreter);
    modalState.setShellDraft(nextSettings.tooling.shell);
  };

  const handleSavePersonalization = async () => {
    const submitted = modalState.globalInstructionsDraft;
    const nextSettings = await patchSettings([{ op: 'globalInstructions', value: submitted }]);
    // Autosave runs while the user may still be typing: adopt the saved text only if the draft is unchanged,
    // so newer input survives and is saved by the next idle tick.
    modalState.setGlobalInstructionsDraft((current) =>
      current === submitted ? nextSettings.agents.globalInstructions : current,
    );
  };

  return {
    handleAvatarSelect,
    handleAccountSave,
    handleDisconnectProvider,
    handleSaveAgentManifests,
    handleImportAgentManifest,
    handleAgentModelOps,
    previewAgentOverrideFile,
    handleDeleteAgentOverrideFile,
    previewProjectAgentTrust,
    handleTrustProjectAgent,
    loadAgentBuiltinComparison,
    handleSaveToolsConfig,
    handleSavePersonalization,
  };
}
