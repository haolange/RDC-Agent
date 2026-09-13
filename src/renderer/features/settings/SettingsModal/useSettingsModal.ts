import { useEffect, useMemo, useState } from 'react';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { useProjectStore } from '../../../stores/projectStore';
import { useI18n } from '../../../i18n';
import type { AgentManifestDraft } from '@shared/types/agentManifest';
import type { AppSettings, LlmProviderEntry } from '@shared/types/settings';
import type { ProviderCatalogSnapshot } from './types';
import { createSettingsModalActions } from './settingsModalActions';
import { findProjectedHandoffTargetConflicts, validateAgentHandoffs } from './sections/agentHandoffValidation';
import { rollbackAgentManifestDrafts, useAgentManifestAutosave } from './useAgentManifestAutosave';
import { useProviderConnection } from './useProviderConnection';
import { useSettingsModalState } from './useSettingsModalState';
import { useSettingsDirty } from './settingsDirtyState';
import {
  getEnabledModels,
  getProviderDisplayLabel,
  sortProvidersByLabel,
} from './utils';



const EMPTY_PROVIDER_CATALOG_SNAPSHOT: ProviderCatalogSnapshot = {
  categories: [],
  protocols: [],
  providers: [],
};

const normalizeProviderCatalogSnapshot = (snapshot: ProviderCatalogSnapshot | null | undefined): ProviderCatalogSnapshot => ({
  categories: Array.isArray(snapshot?.categories) ? snapshot.categories : [],
  protocols: Array.isArray(snapshot?.protocols) ? snapshot.protocols : [],
  providers: Array.isArray(snapshot?.providers) ? snapshot.providers : [],
});

export const useSettingsModal = (open: boolean, settings: AppSettings) => {
  const { t } = useI18n();
  const setTheme = useAppSettingsStore((state) => state.setTheme);
  const setLanguage = useAppSettingsStore((state) => state.setLanguage);
  const setFontScale = useAppSettingsStore((state) => state.setFontScale);
  const setComposerMarkdown = useAppSettingsStore((state) => state.setComposerMarkdown);
  const setUsePointerCursors = useAppSettingsStore((state) => state.setUsePointerCursors);
  const setReduceMotion = useAppSettingsStore((state) => state.setReduceMotion);
  const setChromeTheme = useAppSettingsStore((state) => state.setChromeTheme);
  const updateProfile = useAppSettingsStore((state) => state.updateProfile);
  const patchSettings = useAppSettingsStore((state) => state.patchSettings);
  const saveProvider = useAppSettingsStore((state) => state.saveProvider);
  const saveAgentDefinition = useAppSettingsStore((state) => state.saveAgentDefinition);
  const reloadSettings = useAppSettingsStore((state) => state.reloadSettings);
  const currentProjectId = useProjectStore((state) => state.currentProject?.projectId ?? null);

  const modalState = useSettingsModalState(open, settings, currentProjectId);
  const [providerCatalogSnapshot, setProviderCatalogSnapshot] = useState<ProviderCatalogSnapshot>(EMPTY_PROVIDER_CATALOG_SNAPSHOT);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void window.electronAPI.settings.getProviderCatalog()
      .then((snapshot) => {
        if (!cancelled) {
          setProviderCatalogSnapshot(normalizeProviderCatalogSnapshot(snapshot));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProviderCatalogSnapshot(EMPTY_PROVIDER_CATALOG_SNAPSHOT);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const providerConnection = useProviderConnection({
    open,
    settings,
    providerDrafts: modalState.providerDrafts,
    setProviderDrafts: modalState.setProviderDrafts,
    setAgentRouteDrafts: modalState.setAgentRouteDrafts,
    selectedProviderId: modalState.selectedProviderId,
    setSelectedProviderId: modalState.setSelectedProviderId,
    connectionDraft: modalState.connectionDraft,
    setConnectionDraft: modalState.setConnectionDraft,
    reloadSettings,
    saveProvider,
    t,
  });

  const routableProviders = useMemo(
    () => sortProvidersByLabel(modalState.providerDrafts.filter((provider) => provider.enabled && provider.isConfigured && getEnabledModels(provider).length > 0)),
    [modalState.providerDrafts],
  );
  const accountProviders = useMemo(
    () => sortProvidersByLabel(modalState.providerDrafts.filter((provider) => provider.category === 'login-authorization')),
    [modalState.providerDrafts],
  );
  const providerCatalog = useMemo(
    () => sortProvidersByLabel(modalState.providerDrafts.filter((provider) => provider.category !== 'login-authorization')),
    [modalState.providerDrafts],
  );
  const configuredProvidersWithoutEnabledModels = useMemo(
    () => sortProvidersByLabel(modalState.providerDrafts.filter((provider) => provider.enabled && provider.isConfigured && getEnabledModels(provider).length === 0)),
    [modalState.providerDrafts],
  );
  const getResolvedProviderLabel = (provider: Pick<LlmProviderEntry, 'label'>) =>
    getProviderDisplayLabel(provider, t('settings.unnamedProvider'));

  const sections: Array<{ id: typeof modalState.activeSection; label: string; subtitle: string }> = useMemo(() => [
    { id: 'general', label: t('settings.general'), subtitle: t('settings.generalSubtitle') },
    { id: 'appearance', label: t('settings.appearance'), subtitle: t('settings.appearanceSubtitle') },
    { id: 'models', label: t('settings.models'), subtitle: t('settings.modelsSubtitle') },
    { id: 'agents', label: t('settings.agentManifestTitle'), subtitle: t('settings.agentsSubtitle') },
    { id: 'skills', label: t('settings.skills'), subtitle: t('settings.skillsSubtitle') },
    { id: 'tools', label: t('settings.toolsAndExtensions'), subtitle: t('settings.toolsSubtitle') },
    { id: 'hooks', label: t('settings.hooks'), subtitle: t('settings.hooksSubtitle') },
    { id: 'policy', label: t('settings.policy'), subtitle: t('settings.policySubtitle') },
  ], [t]);

  const blockSubmit = (draft: AgentManifestDraft) => {
    const issues = validateAgentHandoffs(draft.handoffs, {
      selfId: draft.id,
      definitions: modalState.agentManifestDrafts.filter((entry) => !entry.delete),
      modelOptions: settings.agents.modelOptions,
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
  });
  useAgentManifestAutosave({
    open,
    settings,
    agentManifestDrafts: modalState.agentManifestDrafts,
    currentProjectId,
    onSave: actions.handleSaveAgentManifests,
    onRollback: (failedDrafts, savedDrafts) => {
      modalState.setAgentManifestDrafts((current) => rollbackAgentManifestDrafts(
        current,
        failedDrafts,
        savedDrafts,
      ));
    },
    onSaveStateChange: modalState.setAgentManifestSaveState,
    onSaveMessageChange: modalState.setAgentManifestSaveMessage,
    onBlockedChange: modalState.setAgentManifestSaveBlocked,
    blockSubmit,
    blockProjectedSubmit,
    savedMessage: t('settings.agentManifestSaved'),
    failedMessage: t('settings.agentManifestSaveFailed'),
  });

  const dirty = useSettingsDirty(settings, {
    tools: {
      rdxCli: modalState.rdxCliDraft,
      codeInterpreter: modalState.codeInterpreterDraft,
      shell: modalState.shellDraft,
    },
    profile: modalState.accountDraft,
    globalInstructions: modalState.globalInstructionsDraft,
  });

  return {
    t,
    settings,
    ...modalState,
    sections,
    dirty,
    routableProviders,
    accountProviders,
    providerCatalog,
    providerCatalogCategories: providerCatalogSnapshot.categories,
    configuredProvidersWithoutEnabledModels,
    getResolvedProviderLabel,
    setTheme,
    setLanguage,
    setFontScale,
    setComposerMarkdown,
    setUsePointerCursors,
    setReduceMotion,
    setChromeTheme,
    ...actions,
    ...providerConnection,
  };
};
