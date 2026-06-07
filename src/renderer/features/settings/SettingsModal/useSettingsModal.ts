import { useMemo } from 'react';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { useI18n } from '../../../i18n';
import type { TranslationKey } from '../../../i18n';
import type { AppSettings, LlmAgentRoute, LlmProviderEntry } from '@shared/types/settings';
import { AGENT_ROLES } from '@shared/constants/agents';
import { resolveAgentRouteStatus } from './agentRouteStatus';
import { useProviderConnection } from './useProviderConnection';
import { useSettingsModalState } from './useSettingsModalState';
import {
  getEnabledModels,
  getErrorMessage,
  getProviderDisplayLabel,
  joinPath,
  sortProvidersByLabel,
} from './utils';

export const useSettingsModal = (open: boolean, settings: AppSettings) => {
  const { t } = useI18n();
  const setTheme = useAppSettingsStore((state) => state.setTheme);
  const setLanguage = useAppSettingsStore((state) => state.setLanguage);
  const setFontScale = useAppSettingsStore((state) => state.setFontScale);
  const updateProfile = useAppSettingsStore((state) => state.updateProfile);
  const updateWorkspaceRoot = useAppSettingsStore((state) => state.updateWorkspaceRoot);
  const resetWorkspaceRoot = useAppSettingsStore((state) => state.resetWorkspaceRoot);
  const patchSettings = useAppSettingsStore((state) => state.patchSettings);
  const reloadSettings = useAppSettingsStore((state) => state.reloadSettings);

  const modalState = useSettingsModalState(open, settings);

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
    t,
  });

  const routableProviders = useMemo(
    () => sortProvidersByLabel(modalState.providerDrafts.filter((provider) => provider.enabled && provider.isConfigured && getEnabledModels(provider).length > 0)),
    [modalState.providerDrafts],
  );
  const accountProviders = useMemo(
    () => sortProvidersByLabel(modalState.providerDrafts.filter((provider) => provider.authMode === 'account')),
    [modalState.providerDrafts],
  );
  const providerCatalog = useMemo(
    () => sortProvidersByLabel(modalState.providerDrafts.filter((provider) => provider.authMode !== 'account')),
    [modalState.providerDrafts],
  );
  const configuredProvidersWithoutEnabledModels = useMemo(
    () => sortProvidersByLabel(modalState.providerDrafts.filter((provider) => provider.enabled && provider.isConfigured && getEnabledModels(provider).length === 0)),
    [modalState.providerDrafts],
  );
  const invalidAgentRoutes = useMemo(
    () => AGENT_ROLES.map((agentId) => {
      const route = modalState.agentRouteDrafts.find((entry) => entry.agentId === agentId);
      const routeStatus = resolveAgentRouteStatus(route, modalState.providerDrafts);
      return routeStatus.issue ? { agentId, issue: routeStatus.issue } : null;
    }).filter((entry): entry is { agentId: LlmAgentRoute['agentId']; issue: TranslationKey } => entry !== null),
    [modalState.agentRouteDrafts, modalState.providerDrafts],
  );

  const getResolvedProviderLabel = (provider: Pick<LlmProviderEntry, 'label'>) =>
    getProviderDisplayLabel(provider, t('settings.unnamedProvider'));

  const derivedRoot = modalState.workspaceDraft.trim() || settings.paths.defaultWorkspaceRoot || settings.workspace.rootPath;
  const derivedPathEntries = useMemo(() => {
    const derivedPaths = {
      settingsPath: joinPath(derivedRoot, 'settings.json'),
      logPath: joinPath(derivedRoot, 'logs', 'rdc-agent.log'),
      projectsPath: joinPath(derivedRoot, 'projects'),
      knowledgePath: joinPath(derivedRoot, 'knowledge'),
      profilesPath: joinPath(derivedRoot, 'profiles'),
      policiesPath: joinPath(derivedRoot, 'policies'),
    };
    return [
      { label: t('settings.settingsFile'), value: derivedPaths.settingsPath },
      { label: t('settings.logFile'), value: derivedPaths.logPath },
      { label: t('settings.projectsPath'), value: derivedPaths.projectsPath },
      { label: t('settings.knowledgePath'), value: derivedPaths.knowledgePath },
      { label: t('settings.profilesPath'), value: derivedPaths.profilesPath },
      { label: t('settings.policiesPath'), value: derivedPaths.policiesPath },
    ];
  }, [derivedRoot, t]);

  const sections: Array<{ id: typeof modalState.activeSection; label: string }> = useMemo(() => [
    { id: 'general', label: t('settings.general') },
    { id: 'workspace', label: t('settings.workspace') },
    { id: 'models', label: t('settings.models') },
    { id: 'agents', label: t('settings.agents') },
  ], [t]);

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

  const handleSaveAgentRoutes = async () => {
    if (invalidAgentRoutes.length > 0) return;
    await patchSettings({
      llm: {
        agentRoutes: AGENT_ROLES.map((agentId) => {
          const route = modalState.agentRouteDrafts.find((entry) => entry.agentId === agentId);
          return route ?? { agentId, providerId: '', modelId: '' };
        }),
      },
    });
    const nextSettings = await reloadSettings();
    modalState.setAgentRouteDrafts(nextSettings.llm.agentRoutes.map((route) => ({ ...route })));
  };

  return {
    t,
    settings,
    ...modalState,
    sections,
    derivedPathEntries,
    routableProviders,
    accountProviders,
    providerCatalog,
    configuredProvidersWithoutEnabledModels,
    getResolvedProviderLabel,
    setTheme,
    setLanguage,
    setFontScale,
    updateProfile,
    updateWorkspaceRoot,
    resetWorkspaceRoot,
    handleRefreshProviderModels,
    handleDisconnectProvider,
    handleSaveAgentRoutes,
    ...providerConnection,
  };
};
