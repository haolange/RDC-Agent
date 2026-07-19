import { useEffect, useMemo, useState } from 'react';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { useI18n } from '../../../i18n';
import type { AppSettings, LlmProviderEntry } from '@shared/types/settings';
import type { ProviderCatalogSnapshot } from './types';
import { createSettingsModalActions } from './settingsModalActions';
import { rollbackAgentManifestDrafts, useAgentManifestAutosave } from './useAgentManifestAutosave';
import { useProviderConnection } from './useProviderConnection';
import { useSettingsModalState } from './useSettingsModalState';
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
  const updateProfile = useAppSettingsStore((state) => state.updateProfile);
  const patchSettings = useAppSettingsStore((state) => state.patchSettings);
  const saveProvider = useAppSettingsStore((state) => state.saveProvider);
  const saveAgentDefinition = useAppSettingsStore((state) => state.saveAgentDefinition);
  const reloadSettings = useAppSettingsStore((state) => state.reloadSettings);

  const modalState = useSettingsModalState(open, settings);
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

  const sections: Array<{ id: typeof modalState.activeSection; label: string }> = useMemo(() => [
    { id: 'general', label: t('settings.general') },
    { id: 'workspace', label: t('settings.workspace') },
    { id: 'models', label: t('settings.models') },
    { id: 'skills', label: t('settings.skills') },
    { id: 'agents', label: t('settings.agentManifestTitle') },
    { id: 'tools', label: t('settings.toolsAndExtensions') },
    { id: 'hooks', label: t('settings.hooks') },
    { id: 'diagnostics', label: t('settings.diagnostics') },
  ], [t]);

  const actions = createSettingsModalActions({
    modalState,
    providerConnection,
    updateProfile,
    patchSettings,
    saveAgentDefinition,
    t,
  });
  useAgentManifestAutosave({
    open,
    settings,
    agentManifestDrafts: modalState.agentManifestDrafts,
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
    savedMessage: t('settings.agentManifestSaved'),
    failedMessage: t('settings.agentManifestSaveFailed'),
  });

  return {
    t,
    settings,
    ...modalState,
    sections,
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
    ...actions,
    ...providerConnection,
  };
};
