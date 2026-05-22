import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { useI18n } from '../../../i18n';
import type { TranslationKey } from '../../../i18n';
import DropdownSelect, { type DropdownOption } from '../../../ui/DropdownSelect';
import type {
  AppSettings,
  AppTheme,
  FontScale,
  LlmAgentRoute,
  LlmProviderEntry,
  LlmProviderModel,
} from '@shared/types/settings';
import { AGENT_DISPLAY_NAMES, AGENT_ROLES } from '@shared/constants/agents';
import { ProfileAvatar } from '../../../ui/ProfileAvatar';
import './SettingsModal.css';

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
}

type SettingsSection = 'general' | 'workspace' | 'models' | 'agents';
type ProviderConnectionBusyState = 'idle' | 'testing' | 'saving';

interface ProviderConnectionDraft {
  providerId: string;
  apiKey: string;
  showApiKey: boolean;
  busy: ProviderConnectionBusyState;
  error: string;
  testedApiKey: string;
  models: LlmProviderModel[];
}

const joinPath = (root: string, ...segments: string[]): string => {
  const separator = root.includes('\\') ? '\\' : '/';
  return [root.replace(/[\\/]+$/, ''), ...segments.map((segment) => segment.replace(/^[\\/]+/, ''))]
    .filter(Boolean)
    .join(separator);
};

const cloneProvider = (provider: LlmProviderEntry): LlmProviderEntry => ({
  ...provider,
  models: provider.models.map((model) => ({ ...model })),
  recommendedModels: [...provider.recommendedModels],
});

const cloneRoute = (route: LlmAgentRoute): LlmAgentRoute => ({ ...route });

const getEnabledModels = (provider?: Pick<LlmProviderEntry, 'models'> | null) =>
  provider?.models.filter((model) => model.enabled) ?? [];

const getProviderDisplayLabel = (
  provider: Pick<LlmProviderEntry, 'label'>,
  fallbackLabel: string,
): string => provider.label.trim() || fallbackLabel;

const getProviderGroupLabel = (provider: Pick<LlmProviderEntry, 'catalogGroup'>): string => {
  if (provider.catalogGroup === 'local') return 'Local';
  if (provider.catalogGroup === 'account') return 'Account';
  return 'API Key';
};

const getProviderStatusLabel = (provider: Pick<LlmProviderEntry, 'status' | 'isConfigured'>): TranslationKey => {
  if (provider.status === 'verified' && provider.isConfigured) return 'settings.providerConnected';
  if (provider.status === 'failed') return 'settings.providerFailed';
  if (provider.status === 'unavailable') return 'settings.providerUnavailable';
  return 'settings.providerUnconfigured';
};

const formatLastTested = (value?: string): string => {
  if (!value) return '';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return '';
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
};

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, settings, onClose }) => {
  const { t } = useI18n();
  const setTheme = useAppSettingsStore((state) => state.setTheme);
  const setLanguage = useAppSettingsStore((state) => state.setLanguage);
  const setFontScale = useAppSettingsStore((state) => state.setFontScale);
  const updateProfile = useAppSettingsStore((state) => state.updateProfile);
  const updateWorkspaceRoot = useAppSettingsStore((state) => state.updateWorkspaceRoot);
  const resetWorkspaceRoot = useAppSettingsStore((state) => state.resetWorkspaceRoot);
  const reloadSettings = useAppSettingsStore((state) => state.reloadSettings);
  const saveAgentRoute = useAppSettingsStore((state) => state.saveAgentRoute);

  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [accountDraft, setAccountDraft] = useState(settings.profile);
  const [workspaceDraft, setWorkspaceDraft] = useState(settings.workspace.rootPath);
  const [providerDrafts, setProviderDrafts] = useState<LlmProviderEntry[]>(settings.llm.providers.map(cloneProvider));
  const [agentRouteDrafts, setAgentRouteDrafts] = useState<LlmAgentRoute[]>(settings.llm.agentRoutes.map(cloneRoute));
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(settings.llm.providers[0]?.id ?? null);
  const [connectionDraft, setConnectionDraft] = useState<ProviderConnectionDraft | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;

    wasOpenRef.current = true;
    setActiveSection('general');
    setAccountDraft(settings.profile);
    setWorkspaceDraft(settings.workspace.rootPath);
    const providers = settings.llm.providers.map(cloneProvider);
    setProviderDrafts(providers);
    setAgentRouteDrafts(settings.llm.agentRoutes.map(cloneRoute));
    setSelectedProviderId(providers[0]?.id ?? null);
    setConnectionDraft(null);
  }, [open, settings]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const selectedProvider = useMemo(
    () => providerDrafts.find((provider) => provider.id === selectedProviderId) ?? null,
    [providerDrafts, selectedProviderId],
  );
  const connectionProvider = useMemo(
    () => providerDrafts.find((provider) => provider.id === connectionDraft?.providerId) ?? null,
    [connectionDraft?.providerId, providerDrafts],
  );
  const routableProviders = useMemo(
    () => providerDrafts.filter((provider) => provider.enabled && provider.isConfigured && getEnabledModels(provider).length > 0),
    [providerDrafts],
  );
  const configuredProvidersWithoutEnabledModels = useMemo(
    () => providerDrafts.filter((provider) => provider.enabled && provider.isConfigured && getEnabledModels(provider).length === 0),
    [providerDrafts],
  );

  const getResolvedProviderLabel = (provider: Pick<LlmProviderEntry, 'label'>) =>
    getProviderDisplayLabel(provider, t('settings.unnamedProvider'));

  const resolveAgentRouteStatus = (route?: LlmAgentRoute): {
    issue: TranslationKey | null;
    provider: LlmProviderEntry | null;
    availableModels: LlmProviderEntry['models'];
  } => {
    if (!route?.providerId) {
      return { issue: 'settings.routeReasonNoProvider', provider: null, availableModels: [] };
    }

    const provider = providerDrafts.find((entry) => entry.id === route.providerId) ?? null;
    if (!provider || !provider.enabled || !provider.isConfigured) {
      return { issue: 'settings.routeReasonProviderUnavailable', provider, availableModels: [] };
    }

    const availableModels = getEnabledModels(provider);
    if (availableModels.length === 0) {
      return { issue: 'settings.routeReasonNoModels', provider, availableModels };
    }

    if (!route.modelId || !availableModels.some((model) => model.id === route.modelId)) {
      return { issue: 'settings.routeReasonModelInvalid', provider, availableModels };
    }

    return { issue: null, provider, availableModels };
  };

  const derivedRoot = workspaceDraft.trim() || settings.paths.defaultWorkspaceRoot || settings.workspace.rootPath;
  const derivedPaths = {
    settingsPath: joinPath(derivedRoot, 'settings.json'),
    logPath: joinPath(derivedRoot, 'logs', 'rdc-agent.log'),
    projectsPath: joinPath(derivedRoot, 'projects'),
    knowledgePath: joinPath(derivedRoot, 'knowledge'),
    profilesPath: joinPath(derivedRoot, 'profiles'),
    policiesPath: joinPath(derivedRoot, 'policies'),
  };
  const derivedPathEntries = [
    { label: t('settings.settingsFile'), value: derivedPaths.settingsPath },
    { label: t('settings.logFile'), value: derivedPaths.logPath },
    { label: t('settings.projectsPath'), value: derivedPaths.projectsPath },
    { label: t('settings.knowledgePath'), value: derivedPaths.knowledgePath },
    { label: t('settings.profilesPath'), value: derivedPaths.profilesPath },
    { label: t('settings.policiesPath'), value: derivedPaths.policiesPath },
  ];

  const invalidAgentRoutes = useMemo(
    () => agentRouteDrafts.filter((route) => resolveAgentRouteStatus(route).issue !== null),
    [agentRouteDrafts, providerDrafts],
  );

  if (!open) return null;

  const handleAvatarSelect = async () => {
    const avatarPath = await window.electronAPI?.appShell.selectAvatar();
    if (!avatarPath) return;
    setAccountDraft((current) => ({ ...current, avatarPath }));
  };

  const handleAccountSave = async () => {
    await updateProfile(accountDraft);
  };

  const handleWorkspacePick = async () => {
    const nextRoot = await window.electronAPI?.selectDirectory();
    if (nextRoot) {
      setWorkspaceDraft(nextRoot);
    }
  };

  const handleWorkspaceSave = async () => {
    await updateWorkspaceRoot(workspaceDraft.trim() || settings.paths.defaultWorkspaceRoot);
  };

  const handleWorkspaceReset = async () => {
    setWorkspaceDraft(settings.paths.defaultWorkspaceRoot);
    await resetWorkspaceRoot();
  };

  const refreshLocalSettings = async (preferredProviderId?: string) => {
    const nextSettings = await reloadSettings();
    const nextProviders = nextSettings.llm.providers.map(cloneProvider);
    setProviderDrafts(nextProviders);
    setAgentRouteDrafts(nextSettings.llm.agentRoutes.map(cloneRoute));
    setSelectedProviderId(
      preferredProviderId && nextProviders.some((provider) => provider.id === preferredProviderId)
        ? preferredProviderId
        : selectedProviderId && nextProviders.some((provider) => provider.id === selectedProviderId)
          ? selectedProviderId
          : nextProviders[0]?.id ?? null,
    );
    return nextSettings;
  };

  const openProviderConnection = (provider: LlmProviderEntry) => {
    if (provider.authMode === 'account' && !provider.accountLoginConfigured) {
      return;
    }
    setConnectionDraft({
      providerId: provider.id,
      apiKey: '',
      showApiKey: false,
      busy: 'idle',
      error: '',
      testedApiKey: '',
      models: [],
    });
  };

  const updateConnectionDraft = (patch: Partial<ProviderConnectionDraft>) => {
    setConnectionDraft((current) => current ? { ...current, ...patch } : current);
  };

  const handleTestProviderDraft = async () => {
    if (!connectionDraft) return;
    updateConnectionDraft({ busy: 'testing', error: '', models: [] });
    const result = await window.electronAPI.llm.testProviderDraft({
      providerId: connectionDraft.providerId,
      apiKey: connectionDraft.apiKey,
    });
    if (!result.success) {
      updateConnectionDraft({ busy: 'idle', error: result.error ?? t('settings.providerTestFailed'), models: [] });
      return;
    }
    updateConnectionDraft({
      busy: 'idle',
      error: '',
      testedApiKey: connectionDraft.apiKey,
      models: result.models,
    });
  };

  const handleSaveProviderConnection = async () => {
    if (!connectionDraft) return;
    updateConnectionDraft({ busy: 'saving', error: '' });
    const result = await window.electronAPI.llm.connectProvider({
      providerId: connectionDraft.providerId,
      apiKey: connectionDraft.apiKey,
    });
    if (!result.success) {
      updateConnectionDraft({ busy: 'idle', error: result.error ?? t('settings.providerSaveFailed'), models: [] });
      return;
    }
    await refreshLocalSettings(connectionDraft.providerId);
    setConnectionDraft(null);
  };

  const handleRefreshProviderModels = async (provider: LlmProviderEntry) => {
    setProviderDrafts((current) => current.map((entry) => (
      entry.id === provider.id ? { ...entry, status: 'unconfigured', lastError: '' } : entry
    )));
    const result = await window.electronAPI.llm.refreshProviderModels(provider.id);
    if (!result.success) {
      setProviderDrafts((current) => current.map((entry) => (
        entry.id === provider.id ? { ...entry, status: 'failed', lastError: result.error } : entry
      )));
      return;
    }
    await refreshLocalSettings(provider.id);
  };

  const handleDisconnectProvider = async (provider: LlmProviderEntry) => {
    const result = await window.electronAPI.llm.disconnectProvider(provider.id);
    if (!result.success) {
      setProviderDrafts((current) => current.map((entry) => (
        entry.id === provider.id ? { ...entry, status: 'failed', lastError: result.error } : entry
      )));
      return;
    }
    await refreshLocalSettings(provider.id);
  };

  const handleRouteChange = (agentId: LlmAgentRoute['agentId'], patch: Partial<LlmAgentRoute>) => {
    setAgentRouteDrafts((current) => current.map((route) => {
      if (route.agentId !== agentId) return route;
      return {
        ...route,
        ...patch,
      };
    }));
  };

  const handleSaveAgentRoutes = async () => {
    if (invalidAgentRoutes.length > 0) return;
    for (const route of agentRouteDrafts) {
      await saveAgentRoute(route);
    }
  };

  const connectionNeedsApiKey = Boolean(
    connectionDraft
    && connectionProvider?.authMode === 'api-key'
    && !connectionProvider.hasStoredSecret
    && !connectionDraft.apiKey.trim(),
  );
  const connectionHasFreshTest = Boolean(
    connectionDraft
    && connectionDraft.models.length > 0
    && connectionDraft.testedApiKey === connectionDraft.apiKey,
  );

  const sections: Array<{ id: SettingsSection; label: string }> = [
    { id: 'general', label: t('settings.general') },
    { id: 'workspace', label: t('settings.workspace') },
    { id: 'models', label: t('settings.models') },
    { id: 'agents', label: t('settings.agents') },
  ];

  return createPortal(
    <div className="settings-modal-backdrop" onClick={onClose}>
      <div
        className="settings-modal settings-center"
        data-testid="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        aria-describedby="settings-modal-subtitle"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="settings-center-sidebar">
          <div className="settings-center-brand">
            <div className="settings-center-brand-icon">RD</div>
            <div className="settings-center-brand-copy">
              <div className="settings-center-brand-title">RDC Agent</div>
              <div className="settings-center-brand-subtitle">{t('settings.title')}</div>
            </div>
          </div>

          <div className="settings-center-nav">
            {sections.map((section) => (
              <button
                key={section.id}
                type="button"
                className={`settings-center-nav-item ${activeSection === section.id ? 'active' : ''}`}
                data-testid={`settings-nav-${section.id}`}
                onClick={() => setActiveSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </div>
        </div>

        <div className="settings-center-content">
          <div className="settings-modal-header">
            <div className="settings-modal-heading">
              <div className="settings-modal-title" id="settings-modal-title">{sections.find((section) => section.id === activeSection)?.label}</div>
              <div className="settings-modal-subtitle" id="settings-modal-subtitle">
                {activeSection === 'general' && t('settings.generalSubtitle')}
                {activeSection === 'workspace' && t('settings.workspaceSubtitle')}
                {activeSection === 'models' && t('settings.modelsSubtitle')}
                {activeSection === 'agents' && t('settings.agentsSubtitle')}
              </div>
            </div>
            <button type="button" className="settings-modal-close" onClick={onClose} aria-label={t('settings.close')}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="settings-center-panel" data-testid="settings-center-panel">
            {activeSection === 'general' && (
              <section className="settings-page settings-page-general">
                <div className="settings-section">
                  <div className="settings-section-header">
                    <div>
                      <div className="settings-section-title">{t('settings.profile')}</div>
                      <div className="settings-section-subtitle">{t('settings.profileHint')}</div>
                    </div>
                  </div>

                  <div className="settings-profile-row">
                    <div className="settings-account-avatar-shell">
                      <ProfileAvatar
                        className="settings-account-avatar"
                        fallbackClassName="settings-account-avatar-fallback"
                        avatarPath={accountDraft.avatarPath}
                        nickname={accountDraft.nickname}
                      />
                    </div>
                    <div className="settings-profile-fields">
                      <label className="settings-field">
                        <span className="settings-field-label">{t('settings.nickname')}</span>
                        <input
                          className="input"
                          value={accountDraft.nickname}
                          onChange={(event) => setAccountDraft((current) => ({ ...current, nickname: event.target.value }))}
                        />
                      </label>
                      <div className="settings-profile-actions">
                        <button type="button" className="button button-secondary" onClick={() => void handleAvatarSelect()}>
                          {t('settings.uploadAvatar')}
                        </button>
                        <button type="button" className="button button-primary" onClick={() => void handleAccountSave()}>
                          {t('settings.save')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="settings-section">
                  <div className="settings-section-header">
                    <div>
                      <div className="settings-section-title">{t('settings.appearance')}</div>
                      <div className="settings-section-subtitle">{t('settings.appearanceHint')}</div>
                    </div>
                  </div>
                <div className="settings-option-block">
                  <div className="settings-field-label">{t('userMenu.theme')}</div>
                  <div className="user-menu-pill-group settings-inline-pills">
                    {(['dark', 'light', 'system'] as AppTheme[]).map((theme) => (
                      <button
                        key={theme}
                        type="button"
                        className={`user-menu-pill ${settings.appearance.theme === theme ? 'active' : ''}`}
                        onClick={() => void setTheme(theme)}
                      >
                        {t(`theme.${theme}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings-option-block">
                  <div className="settings-field-label">{t('userMenu.language')}</div>
                  <div className="user-menu-pill-group settings-inline-pills">
                    <button
                      type="button"
                      className={`user-menu-pill ${settings.appearance.language === 'zh-CN' ? 'active' : ''}`}
                      onClick={() => void setLanguage('zh-CN')}
                    >
                      {t('language.zh')}
                    </button>
                    <button
                      type="button"
                      className={`user-menu-pill ${settings.appearance.language === 'en' ? 'active' : ''}`}
                      onClick={() => void setLanguage('en')}
                    >
                      English
                    </button>
                  </div>
                </div>

                <div className="settings-option-block">
                  <div className="settings-field-label">{t('userMenu.fontScale')}</div>
                  <div className="user-menu-pill-group settings-inline-pills">
                    {(['small', 'medium', 'large'] as FontScale[]).map((fontScale) => (
                      <button
                        key={fontScale}
                        type="button"
                        className={`user-menu-pill ${settings.appearance.fontScale === fontScale ? 'active' : ''}`}
                        onClick={() => void setFontScale(fontScale)}
                      >
                        {t(`font.${fontScale}`)}
                      </button>
                    ))}
                  </div>
                </div>
                </div>
              </section>
            )}

            {activeSection === 'workspace' && (
              <section className="settings-page settings-page-workspace">
                <div className="settings-workspace-page scrollbar-thin" data-testid="settings-workspace-body">
                  <div className="settings-workspace-hero">
                    <div className="settings-workspace-hero-copy">
                      <div className="settings-field-label">{t('settings.workspaceRoot')}</div>
                      <div className="settings-help-text">{t('settings.workspaceRootHint')}</div>
                    </div>
                    <div className="settings-path-value settings-workspace-root-value">{workspaceDraft || settings.paths.defaultWorkspaceRoot}</div>
                    <div className="settings-path-actions settings-workspace-root-actions">
                      <button type="button" className="button button-secondary" onClick={() => void handleWorkspacePick()}>
                        {t('settings.chooseDirectory')}
                      </button>
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => void window.electronAPI.appShell.openPath(workspaceDraft || settings.workspace.rootPath)}
                      >
                        {t('settings.reveal')}
                      </button>
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => void window.electronAPI.appShell.copyText(workspaceDraft || settings.workspace.rootPath)}
                      >
                        {t('settings.copy')}
                      </button>
                    </div>
                  </div>

                  <div className="settings-path-card settings-derived-paths-card">
                    <div className="settings-derived-paths-header">
                      <div className="settings-field-label">{t('settings.derivedPathsTitle')}</div>
                      <div className="settings-help-text">{t('settings.derivedPathsHint')}</div>
                    </div>
                    <div className="settings-derived-path-list">
                      {derivedPathEntries.map((entry) => (
                        <div key={entry.label} className="settings-derived-path-row">
                          <div className="settings-derived-path-copy">
                            <div className="settings-derived-path-label">{entry.label}</div>
                            <div className="settings-derived-path-value">{entry.value}</div>
                          </div>
                          <div className="settings-derived-path-actions">
                            <button
                              type="button"
                              className="button button-secondary settings-derived-path-button"
                              onClick={() => void window.electronAPI.appShell.openPath(entry.value)}
                            >
                              {t('settings.reveal')}
                            </button>
                            <button
                              type="button"
                              className="button button-secondary settings-derived-path-button"
                              onClick={() => void window.electronAPI.appShell.copyText(entry.value)}
                            >
                              {t('settings.copy')}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {(settings.configuration.lastMigrationSummary.length > 0 || settings.configuration.diagnostics.length > 0) && (
                    <div className="settings-workspace-meta-grid">
                      {settings.configuration.lastMigrationSummary.length > 0 && (
                        <div className="settings-path-card settings-workspace-note-card">
                          <div className="settings-field-label">{t('settings.lastMigration')}</div>
                          <div className="settings-workspace-note-list">
                            {settings.configuration.lastMigrationSummary.map((summary, index) => (
                              <div key={`${summary}-${index}`} className="settings-workspace-note-item">
                                {summary}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {settings.configuration.diagnostics.length > 0 && (
                        <div className="settings-path-card settings-workspace-note-card">
                          <div className="settings-field-label">{t('settings.diagnostics')}</div>
                          <div className="settings-workspace-note-list">
                            {settings.configuration.diagnostics.map((diagnostic, index) => (
                              <div key={`${diagnostic.message}-${index}`} className="settings-workspace-note-item">
                                {diagnostic.message}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="settings-actions settings-workspace-footer-actions">
                    <button type="button" className="button button-secondary" onClick={() => void handleWorkspaceReset()}>
                      {t('settings.resetWorkspace')}
                    </button>
                    <button type="button" className="button button-primary" onClick={() => void handleWorkspaceSave()}>
                      {t('settings.save')}
                    </button>
                  </div>
                </div>
              </section>
            )}

            {activeSection === 'models' && (
              <section className="settings-page settings-page-models">
                <div className="settings-models-page">
                <aside className="settings-provider-column">
                  <div className="settings-model-sidebar-title">{t('settings.providerCatalog')}</div>
                  <div className="settings-column-title">{t('settings.providerCatalogHint')}</div>
                    <div className="settings-provider-list-wrap scrollbar-thin" data-testid="settings-provider-list">
                      <div className="settings-provider-list">
                        {providerDrafts.map((provider) => (
                        <button
                          key={provider.id}
                          type="button"
                          className={`settings-provider-item ${selectedProviderId === provider.id ? 'active' : ''}`}
                          data-testid={`settings-provider-item-${provider.id}`}
                          aria-pressed={selectedProviderId === provider.id}
                          onClick={() => setSelectedProviderId(provider.id)}
                        >
                          <div
                            className="settings-provider-tile"
                            data-testid={`settings-provider-summary-${provider.id}`}
                          >
                            <div
                              className="settings-provider-icon-shell"
                              data-testid={`settings-provider-icon-${provider.id}`}
                            >
                              <span className={`settings-provider-status ${provider.isConfigured ? 'configured' : 'pending'}`} />
                              <span className="settings-provider-icon">
                                {getResolvedProviderLabel(provider).slice(0, 1).toUpperCase()}
                              </span>
                            </div>
                            <span className="settings-provider-item-copy">
                              <span
                                className="settings-provider-item-label"
                                data-testid={`settings-provider-label-${provider.id}`}
                              >
                                {getResolvedProviderLabel(provider)}
                              </span>
                              <span className="settings-provider-item-meta">
                                {getProviderGroupLabel(provider)}
                                {' · '}
                                {t(getProviderStatusLabel(provider))}
                                {' · '}
                                {t('settings.providerModelCount', { count: getEnabledModels(provider).length })}
                              </span>
                            </span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-provider-toolbar settings-provider-toolbar-static">
                    <div className="settings-provider-toolbar-note">
                      {t('settings.providerCatalogCount', { count: providerDrafts.length })}
                    </div>
                  </div>
                </aside>

                <div className="settings-model-detail scrollbar-thin" data-testid="settings-model-detail">
                  {!selectedProvider ? (
                    <div className="settings-model-detail-body settings-credential-empty settings-empty-state" data-testid="settings-model-detail-body">
                      <div>{t('settings.noSelection')}</div>
                    </div>
                  ) : (
                    <>
                      <div className="settings-model-detail-body" data-testid="settings-model-detail-body">
                      <div className="settings-provider-header">
                        <div>
                          <div className="settings-provider-title">{getResolvedProviderLabel(selectedProvider)}</div>
                          <div className="settings-provider-header-meta">
                            {getProviderGroupLabel(selectedProvider)}
                            {' · '}
                            {selectedProvider.authMode === 'api-key' && t('settings.providerAuthApiKey')}
                            {selectedProvider.authMode === 'local' && t('settings.providerAuthLocal')}
                            {selectedProvider.authMode === 'account' && t('settings.providerAuthAccount')}
                          </div>
                          <div className="settings-provider-title-underline" />
                        </div>
                        <div className="settings-provider-header-state">
                          <span className={`settings-provider-status ${selectedProvider.isConfigured ? 'configured' : 'pending'}`} />
                          <span>{t(getProviderStatusLabel(selectedProvider))}</span>
                        </div>
                      </div>

                      <div className="settings-provider-detail-grid">
                        <div className="settings-provider-detail-card">
                          <span className="settings-field-label">{t('settings.connectionState')}</span>
                          <span className="settings-provider-detail-value">{t(getProviderStatusLabel(selectedProvider))}</span>
                          <span className="settings-help-text">
                            {selectedProvider.hasStoredSecret
                              ? t('settings.providerSecretStored')
                              : selectedProvider.authMode === 'local'
                                ? t('settings.providerLocalNoSecret')
                                : t('settings.providerSecretMissing')}
                          </span>
                        </div>
                        <div className="settings-provider-detail-card">
                          <span className="settings-field-label">{t('settings.discoveredModels')}</span>
                          <span className="settings-provider-detail-value">{getEnabledModels(selectedProvider).length}</span>
                          <span className="settings-help-text">{t('settings.discoveredModelsHint')}</span>
                        </div>
                        <div className="settings-provider-detail-card">
                          <span className="settings-field-label">{t('settings.lastProviderTest')}</span>
                          <span className="settings-provider-detail-value">
                            {formatLastTested(selectedProvider.lastTestedAt) || t('settings.neverTested')}
                          </span>
                          <span className="settings-help-text">{t('settings.lastProviderTestHint')}</span>
                        </div>
                      </div>

                      {selectedProvider.authMode === 'account' && selectedProvider.status === 'unavailable' && (
                        <div className="settings-provider-notice" data-testid={`settings-provider-account-unavailable-${selectedProvider.id}`}>
                          {selectedProvider.unavailableReason || t('settings.providerAccountUnavailable')}
                        </div>
                      )}

                      {selectedProvider.lastError && (
                        <div className="settings-provider-notice error" data-testid={`settings-provider-error-${selectedProvider.id}`}>
                          {selectedProvider.lastError}
                        </div>
                      )}

                      <div className="settings-model-section">
                        <div className="settings-model-section-header">
                          <span>{t('settings.discoveredModels')}</span>
                          {selectedProvider.isConfigured && (
                            <button
                              type="button"
                              className="settings-inline-link"
                              data-testid={`settings-provider-test-${selectedProvider.id}`}
                              onClick={() => void handleRefreshProviderModels(selectedProvider)}
                            >
                              {t('settings.test')}
                            </button>
                          )}
                        </div>

                        <div className="settings-model-list" data-empty-label={t('settings.noEnabledModels')}>
                          {getEnabledModels(selectedProvider).map((model) => (
                            <div key={model.id} className="settings-model-row">
                              <span className="settings-model-row-check">OK</span>
                              <span className="settings-model-row-label">{model.label}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      </div>

                      <div className="settings-actions settings-provider-savebar" data-testid="settings-provider-savebar">
                        {selectedProvider.docsUrl && (
                          <a className="settings-link" href={selectedProvider.docsUrl} target="_blank" rel="noreferrer">
                            {selectedProvider.authMode === 'local' ? t('settings.providerDocs') : t('settings.getApiKey')}
                          </a>
                        )}
                        <button
                          type="button"
                          className="button button-secondary"
                          data-testid={`settings-provider-disconnect-${selectedProvider.id}`}
                          onClick={() => void handleDisconnectProvider(selectedProvider)}
                          disabled={!selectedProvider.isConfigured}
                        >
                          {t('settings.disconnect')}
                        </button>
                        <button
                          type="button"
                          className="button button-primary"
                          data-testid={`settings-provider-connect-${selectedProvider.id}`}
                          onClick={() => openProviderConnection(selectedProvider)}
                          disabled={selectedProvider.authMode === 'account' && !selectedProvider.accountLoginConfigured}
                        >
                          {selectedProvider.isConfigured ? t('settings.edit') : t('settings.connect')}
                        </button>
                      </div>
                    </>
                  )}
                </div>
                </div>
              </section>
            )}

            {activeSection === 'agents' && (
              <section className="settings-page settings-page-agents">
                <div className="settings-agent-page">
                  <div className="settings-agent-page-header">
                    <div className="settings-field-label">{t('settings.agentRouting')}</div>
                    <div className="settings-help-text">{t('settings.agentsHint')}</div>
                    <div className="settings-help-text">
                      {t('settings.activeModeProfile')}: {settings.configuration.activeModeProfileId}
                    </div>
                    {routableProviders.length === 0 && (
                      <div className="settings-help-text">{t('settings.noConfiguredProviders')}</div>
                    )}
                    {configuredProvidersWithoutEnabledModels.length > 0 && (
                      <div className="settings-help-text settings-help-text-warning" data-testid="settings-agent-no-enabled-models">
                        {t('settings.configuredProvidersWithoutModels', {
                          providers: configuredProvidersWithoutEnabledModels.map((provider) => getResolvedProviderLabel(provider)).join(', '),
                        })}
                      </div>
                    )}
                  </div>

                  <div className="settings-agent-grid-header" aria-hidden="true">
                    <span>{t('settings.agentRouting')}</span>
                    <span>{t('settings.providerFieldLabel')}</span>
                    <span>{t('settings.modelFieldLabel')}</span>
                  </div>

                  <div className="settings-agent-list scrollbar-thin" data-testid="settings-agent-list">
                    {AGENT_ROLES.map((agentId) => {
                      const route = agentRouteDrafts.find((entry) => entry.agentId === agentId);
                      const routeStatus = resolveAgentRouteStatus(route);
                      const selectedRouteProvider = routableProviders.find((entry) => entry.id === route?.providerId) ?? null;
                      const availableModels = selectedRouteProvider ? getEnabledModels(selectedRouteProvider) : [];
                      const providerValue = selectedRouteProvider?.id ?? '';
                      const modelValue = availableModels.some((model) => model.id === route?.modelId) ? route?.modelId ?? '' : '';
                      const isInvalid = routeStatus.issue !== null;

                      return (
                        <div
                          key={agentId}
                          className={`settings-agent-card ${isInvalid ? 'invalid' : ''}`}
                          data-testid={`settings-agent-card-${agentId}`}
                        >
                          <div className="settings-agent-card-head">
                            <span>{AGENT_DISPLAY_NAMES[agentId]}</span>
                            {routeStatus.issue && <span className="settings-agent-warning">{t(routeStatus.issue)}</span>}
                          </div>
                          <div className="settings-agent-route-control">
                            <DropdownSelect
                              triggerClassName="settings-select-trigger settings-agent-select-trigger"
                              menuClassName="settings-select-menu"
                              dataTestId={`settings-agent-provider-${agentId}`}
                              ariaLabel={`${AGENT_DISPLAY_NAMES[agentId]} ${t('settings.providerFieldLabel')}`}
                              value={providerValue}
                              options={routableProviders.map<DropdownOption>((entry) => ({
                                value: entry.id,
                                label: getResolvedProviderLabel(entry),
                              }))}
                              placeholder={routableProviders.length === 0
                                ? t('settings.noConfiguredProviders')
                                : t('settings.selectProviderPlaceholder')}
                              onChange={(nextProviderId) => {
                                if (!nextProviderId) {
                                  handleRouteChange(agentId, { providerId: '', modelId: '' });
                                  return;
                                }

                                const nextProvider = routableProviders.find((entry) => entry.id === nextProviderId)
                                  ?? providerDrafts.find((entry) => entry.id === nextProviderId);
                                handleRouteChange(agentId, {
                                  providerId: nextProviderId,
                                  modelId: getEnabledModels(nextProvider)[0]?.id ?? '',
                                });
                              }}
                              disabled={routableProviders.length === 0}
                            />
                          </div>
                          <div className="settings-agent-route-control">
                            <DropdownSelect
                              triggerClassName="settings-select-trigger settings-agent-select-trigger"
                              menuClassName="settings-select-menu"
                              dataTestId={`settings-agent-model-${agentId}`}
                              ariaLabel={`${AGENT_DISPLAY_NAMES[agentId]} ${t('settings.modelFieldLabel')}`}
                              value={modelValue}
                              options={availableModels.map<DropdownOption>((model) => ({
                                value: model.id,
                                label: model.label,
                              }))}
                              placeholder={!selectedRouteProvider
                                ? t('settings.selectProviderFirst')
                                : t('settings.noModelsAvailable')}
                              onChange={(nextModelId) => handleRouteChange(agentId, { modelId: nextModelId })}
                              disabled={!selectedRouteProvider || availableModels.length === 0}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="settings-actions">
                    <button
                      type="button"
                      className="button button-primary"
                      data-testid="settings-agent-save"
                      onClick={() => void handleSaveAgentRoutes()}
                      disabled={invalidAgentRoutes.length > 0}
                    >
                      {t('settings.saveAgentRouting')}
                    </button>
                  </div>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
      {connectionDraft && connectionProvider && (
        <div
          className="settings-provider-connect-layer"
          data-testid="settings-provider-connect-layer"
          onClick={(event) => {
            event.stopPropagation();
            setConnectionDraft(null);
          }}
        >
          <div
            className="settings-provider-connect-dialog"
            data-testid="settings-provider-connect-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-provider-connect-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="settings-provider-connect-header">
              <div>
                <div className="settings-provider-connect-kicker">{getProviderGroupLabel(connectionProvider)}</div>
                <div className="settings-provider-connect-title" id="settings-provider-connect-title">
                  {getResolvedProviderLabel(connectionProvider)}
                </div>
              </div>
              <button
                type="button"
                className="settings-modal-close"
                onClick={() => setConnectionDraft(null)}
                aria-label={t('settings.close')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {connectionProvider.authMode === 'api-key' && (
              <label className="settings-field">
                <span className="settings-field-label">{t('settings.apiKey')}</span>
                <div className="settings-secret-field">
                  <input
                    className="input settings-secret-input"
                    data-testid="settings-provider-connect-api-key"
                    type={connectionDraft.showApiKey ? 'text' : 'password'}
                    value={connectionDraft.apiKey}
                    placeholder={connectionProvider.hasStoredSecret ? t('settings.apiKeyStoredPlaceholder') : ''}
                    onChange={(event) => updateConnectionDraft({
                      apiKey: event.target.value,
                      error: '',
                      testedApiKey: '',
                      models: [],
                    })}
                  />
                  <button
                    type="button"
                    className="settings-secret-toggle"
                    data-testid="settings-provider-connect-api-key-toggle"
                    onClick={() => updateConnectionDraft({ showApiKey: !connectionDraft.showApiKey })}
                    aria-label={connectionDraft.showApiKey ? t('settings.hideSecret') : t('settings.showSecret')}
                    disabled={!connectionDraft.apiKey}
                  >
                    {connectionDraft.showApiKey ? t('settings.hideSecret') : t('settings.showSecret')}
                  </button>
                </div>
                <span className="settings-help-text">
                  {connectionProvider.hasStoredSecret ? t('settings.apiKeyStoredHint') : t('settings.apiKeyConnectHint')}
                </span>
              </label>
            )}

            {connectionProvider.authMode === 'local' && (
              <div className="settings-provider-notice">
                {t('settings.localProviderConnectHint')}
              </div>
            )}

            {connectionProvider.docsUrl && (
              <a className="settings-link" href={connectionProvider.docsUrl} target="_blank" rel="noreferrer">
                {connectionProvider.authMode === 'local' ? t('settings.providerDocs') : t('settings.getApiKey')}
              </a>
            )}

            {connectionDraft.error && (
              <div className="settings-provider-notice error" data-testid="settings-provider-connect-error">
                {connectionDraft.error}
              </div>
            )}

            <div className="settings-model-section settings-provider-connect-models">
              <div className="settings-model-section-header">
                <span>{t('settings.discoveredModels')}</span>
                <span className="settings-help-text">
                  {t('settings.providerModelCount', { count: connectionDraft.models.length })}
                </span>
              </div>
              <div className="settings-model-list" data-empty-label={t('settings.testBeforeSaveHint')}>
                {connectionDraft.models.map((model) => (
                  <div key={model.id} className="settings-model-row">
                    <span className="settings-model-row-check">OK</span>
                    <span className="settings-model-row-label">{model.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="settings-actions settings-provider-connect-actions">
              <button type="button" className="button button-secondary" onClick={() => setConnectionDraft(null)}>
                {t('settings.cancel')}
              </button>
              <button
                type="button"
                className="button button-secondary"
                data-testid="settings-provider-connect-test"
                onClick={() => void handleTestProviderDraft()}
                disabled={connectionDraft.busy !== 'idle' || connectionNeedsApiKey}
              >
                {connectionDraft.busy === 'testing' ? t('settings.testing') : t('settings.test')}
              </button>
              <button
                type="button"
                className="button button-primary"
                data-testid="settings-provider-connect-save"
                onClick={() => void handleSaveProviderConnection()}
                disabled={connectionDraft.busy !== 'idle' || connectionNeedsApiKey}
              >
                {connectionDraft.busy === 'saving'
                  ? t('settings.saving')
                  : connectionHasFreshTest
                    ? t('settings.save')
                    : t('settings.testAndSave')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
};

export default SettingsModal;
