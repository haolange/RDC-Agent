import { useMemo } from 'react';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { useI18n } from '../../../i18n';
import type { AppSettings, LlmProviderEntry } from '@shared/types/settings';
import { resolveAgentRouteStatus } from './agentRouteStatus';
import { createSettingsModalActions } from './settingsModalActions';
import { useProviderConnection } from './useProviderConnection';
import { useSettingsModalState } from './useSettingsModalState';
import {
  getEnabledModels,
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
    () => modalState.agentManifestDrafts.filter((agent) => !agent.delete && agent.enabled).map((agent) => {
      const route = modalState.agentRouteDrafts.find((entry) => entry.agentId === agent.id);
      const routeStatus = resolveAgentRouteStatus(route, modalState.providerDrafts);
      return routeStatus.issue ? { agentId: agent.id, label: agent.name || agent.id, issue: routeStatus.issue } : null;
    }).filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    [modalState.agentManifestDrafts, modalState.agentRouteDrafts, modalState.providerDrafts],
  );
  const invalidAgentRouteMessage = useMemo(() => {
    if (invalidAgentRoutes.length === 0) return '';
    return t('settings.agentRouteInvalidSummary', {
      count: invalidAgentRoutes.length,
      routes: invalidAgentRoutes
        .map((entry) => `${entry.label}: ${t(entry.issue)}`)
        .join('; '),
    });
  }, [invalidAgentRoutes, t]);

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
      skillsPath: joinPath(derivedRoot, 'skills'),
      mcpPath: joinPath(derivedRoot, 'mcp'),
      patternsPath: joinPath(derivedRoot, 'patterns'),
    };
    return [
      { label: t('settings.settingsFile'), value: derivedPaths.settingsPath },
      { label: t('settings.logFile'), value: derivedPaths.logPath },
      { label: t('settings.projectsPath'), value: derivedPaths.projectsPath },
      { label: t('settings.knowledgePath'), value: derivedPaths.knowledgePath },
      { label: t('settings.profilesPath'), value: derivedPaths.profilesPath },
      { label: t('settings.policiesPath'), value: derivedPaths.policiesPath },
      { label: t('settings.skillsPath'), value: derivedPaths.skillsPath },
      { label: t('settings.mcpPath'), value: derivedPaths.mcpPath },
    ];
  }, [derivedRoot, t]);

  const sections: Array<{ id: typeof modalState.activeSection; label: string }> = useMemo(() => [
    { id: 'general', label: t('settings.general') },
    { id: 'workspace', label: t('settings.workspace') },
    { id: 'models', label: t('settings.models') },
    { id: 'skillsAgents', label: t('settings.skillsAgents') },
    { id: 'tools', label: t('settings.toolsAndExtensions') },
  ], [t]);

  const actions = createSettingsModalActions({
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
  });

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
    invalidAgentRoutes,
    invalidAgentRouteMessage,
    getResolvedProviderLabel,
    setTheme,
    setLanguage,
    setFontScale,
    ...actions,
    ...providerConnection,
  };
};
