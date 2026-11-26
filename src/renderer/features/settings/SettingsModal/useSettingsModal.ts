import { useEffect, useMemo, useRef } from 'react';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useI18n } from '../../../i18n';
import { createSettingsModalActions } from './settingsModalActions';
import { findProjectedHandoffTargetConflicts, validateAgentHandoffs } from './sections/agentHandoffValidation';
import { useAgentManifestAutosave } from './useAgentManifestAutosave';
import { rollbackAgentManifestDrafts } from './agentManifestAutosaveState';
import { useProviderConnection } from './useProviderConnection';
import { useSettingsModalState } from './useSettingsModalState';
import { useSettingsDirty } from './settingsDirtyState';
import { getEnabledModels, getProviderDisplayLabel, sortProvidersByLabel } from './utils';
import type { AppSettings, LlmProviderCatalogResponse, LlmProviderEntry } from '@shared/types/settings';
import type { AgentManifestDefinition, AgentManifestDraft } from '@shared/types/agentManifest';

const NO_CATEGORIES: LlmProviderCatalogResponse['categories'] = [];

export const useSettingsModal = (open: boolean, settings: AppSettings) => {
  const { t } = useI18n();
  const setTheme = useAppSettingsStore((state) => state.setTheme);
  const setLanguage = useAppSettingsStore((state) => state.setLanguage);
  const setFontScale = useAppSettingsStore((state) => state.setFontScale);
  const setComposerMarkdown = useAppSettingsStore((state) => state.setComposerMarkdown);
  const setChromeTheme = useAppSettingsStore((state) => state.setChromeTheme);
  const updateProfile = useAppSettingsStore((state) => state.updateProfile);
  const patchSettings = useAppSettingsStore((state) => state.patchSettings);
  const adoptView = useAppSettingsStore((state) => state.adoptView);
  const saveProvider = useAppSettingsStore((state) => state.saveProvider);
  const saveAgentDefinition = useAppSettingsStore((state) => state.saveAgentDefinition);
  const reloadSettings = useAppSettingsStore((state) => state.reloadSettings);
  const currentProjectId = useProjectStore((state) => state.currentProject?.projectId ?? null);

  const modalState = useSettingsModalState(open, settings, currentProjectId);
  // Bound after autosave is created below; adopting settings rebases its saved baseline.
  const rebaseAgentDraftsRef = useRef<(definitions: AgentManifestDefinition[]) => void>(() => {});
  const providerCatalogCategories = useAppSettingsStore((state) => state.providerCatalog?.categories ?? NO_CATEGORIES);

  const refreshSettings = useAppSettingsStore((state) => state.refreshSettings);
  // Opening Settings is where edits made outside the app (secrets, Agent files, trust) are picked up.
  useEffect(() => {
    if (open)
      void refreshSettings().catch((error: unknown) => console.warn('[settings] could not refresh settings', error));
  }, [open, refreshSettings]);

  const providerConnection = useProviderConnection({
    open,
    settings,
    providerDrafts: modalState.providerDrafts,
    setProviderDrafts: modalState.setProviderDrafts,
    selectedProviderId: modalState.selectedProviderId,
    setSelectedProviderId: modalState.setSelectedProviderId,
    connectionDraft: modalState.connectionDraft,
    setConnectionDraft: modalState.setConnectionDraft,
    reloadSettings,
    saveProvider,
    t,
  });

  const routableProviders = useMemo(
    () =>
      sortProvidersByLabel(
        modalState.providerDrafts.filter(
          (provider) => provider.enabled && provider.isConfigured && getEnabledModels(provider).length > 0,
        ),
      ),
    [modalState.providerDrafts],
  );
  const accountProviders = useMemo(
    () =>
      sortProvidersByLabel(modalState.providerDrafts.filter((provider) => provider.category === 'login-authorization')),
    [modalState.providerDrafts],
  );
  const providerCatalog = useMemo(
    () =>
      sortProvidersByLabel(modalState.providerDrafts.filter((provider) => provider.category !== 'login-authorization')),
    [modalState.providerDrafts],
  );
  const configuredProvidersWithoutEnabledModels = useMemo(
    () =>
      sortProvidersByLabel(
        modalState.providerDrafts.filter(
          (provider) => provider.isConfigured && getEnabledModels(provider).length === 0,
        ),
      ),
    [modalState.providerDrafts],
  );
  const getResolvedProviderLabel = (provider: Pick<LlmProviderEntry, 'label'>) =>
    getProviderDisplayLabel(provider, t('settings.unnamedProvider'));

  const sections: Array<{ id: typeof modalState.activeSection; label: string; subtitle: string }> = useMemo(
    () => [
      { id: 'general', label: t('settings.general'), subtitle: t('settings.generalSubtitle') },
      { id: 'appearance', label: t('settings.appearance'), subtitle: t('settings.appearanceSubtitle') },
      { id: 'models', label: t('settings.models'), subtitle: t('settings.modelsSubtitle') },
      { id: 'agents', label: t('settings.agentManifestTitle'), subtitle: t('settings.agentsSubtitle') },
      { id: 'skills', label: t('settings.skills'), subtitle: t('settings.skillsSubtitle') },
      { id: 'tools', label: t('settings.toolsAndExtensions'), subtitle: t('settings.toolsSubtitle') },
      { id: 'hooks', label: t('settings.hooks'), subtitle: t('settings.hooksSubtitle') },
      { id: 'policy', label: t('settings.policy'), subtitle: t('settings.policySubtitle') },
    ],
    [t],
  );

  const blockSubmit = (draft: AgentManifestDraft) => {
    const issues = validateAgentHandoffs(draft.handoffs, {
      selfId: draft.id,
      definitions: modalState.agentManifestAutosaveDrafts.filter((entry) => !entry.delete),
    });
    return issues.length === 0 ? null : t('settings.agentHandoffBlocked', { count: issues.length });
  };
  const blockProjectedSubmit = (projectedDrafts: AgentManifestDraft[]) => {
    const conflict = findProjectedHandoffTargetConflicts(projectedDrafts)[0];
    return conflict
      ? t('settings.agentHandoffBlockedByOther', { source: conflict.sourceId, id: conflict.targetId })
      : null;
  };
  const actions = createSettingsModalActions({
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
    rebaseAgentDrafts: (definitions) => rebaseAgentDraftsRef.current(definitions),
  });
  const agentManifestAutosave = useAgentManifestAutosave({
    open: open && modalState.agentManifestContextReady,
    settings,
    agentManifestDrafts: modalState.agentManifestAutosaveDrafts,
    currentProjectId,
    onSave: actions.handleSaveAgentManifests,
    onRollback: (failedDrafts, savedDrafts) => {
      modalState.setAgentManifestDrafts((current) => rollbackAgentManifestDrafts(current, failedDrafts, savedDrafts));
    },
    onSaveStateChange: modalState.setAgentManifestSaveState,
    onSaveMessageChange: modalState.setAgentManifestSaveMessage,
    onBlockedChange: modalState.setAgentManifestSaveBlocked,
    blockSubmit,
    blockProjectedSubmit,
    savedMessage: t('settings.agentManifestSaved'),
    failedMessage: t('settings.agentManifestSaveFailed'),
  });

  useEffect(() => {
    rebaseAgentDraftsRef.current = agentManifestAutosave.rebase;
  });

  const dirty = useSettingsDirty(settings, {
    tools: {
      rdcCli: modalState.rdcCliDraft,
      codeInterpreter: modalState.codeInterpreterDraft,
      shell: modalState.shellDraft,
    },
    profile: modalState.accountDraft,
    globalInstructions: modalState.globalInstructionsDraft,
  });

  return {
    t,
    settings,
    currentProjectId,
    ...modalState,
    sections,
    dirty,
    routableProviders,
    accountProviders,
    providerCatalog,
    providerCatalogCategories,
    configuredProvidersWithoutEnabledModels,
    getResolvedProviderLabel,
    setTheme,
    setLanguage,
    setFontScale,
    setComposerMarkdown,
    setChromeTheme,
    ...actions,
    handleSaveAgentManifests: agentManifestAutosave.retry,
    ...providerConnection,
  };
};
