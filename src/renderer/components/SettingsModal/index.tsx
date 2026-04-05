import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAppSettingsStore } from '../../stores/appSettingsStore';
import { useI18n } from '../../i18n';
import type { TranslationKey } from '../../i18n';
import type {
  AppSettings,
  AppTheme,
  FontScale,
  LlmAgentRoute,
  LlmProviderEntry,
  LlmProviderKind,
} from '@shared/types/settings';
import { AGENT_DISPLAY_NAMES, AGENT_ROLES } from '@shared/constants/agents';
import { BUILTIN_LLM_PROVIDER_DEFINITIONS } from '@shared/constants/llm';
import './SettingsModal.css';

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
}

type SettingsSection = 'account' | 'general' | 'workspace' | 'models';

const PROVIDER_KIND_OPTIONS: LlmProviderKind[] = ['openrouter', 'openai-compatible', 'anthropic', 'ollama'];

const toFileUrl = (filePath?: string): string | undefined => {
  if (!filePath) return undefined;
  return `file:///${filePath.replace(/\\/g, '/')}`;
};

const joinPath = (root: string, ...segments: string[]): string => {
  const separator = root.includes('\\') ? '\\' : '/';
  return [root.replace(/[\\/]+$/, ''), ...segments.map((segment) => segment.replace(/^[\\/]+/, ''))]
    .filter(Boolean)
    .join(separator);
};

const createCustomProvider = (): LlmProviderEntry => ({
  id: `provider-${crypto.randomUUID()}`,
  kind: 'openai-compatible',
  label: '',
  enabled: false,
  apiKey: '',
  baseUrl: '',
  models: [],
  recommendedModels: [],
  docsUrl: '',
  isConfigured: false,
});

const cloneProvider = (provider: LlmProviderEntry): LlmProviderEntry => ({
  ...provider,
  models: provider.models.map((model) => ({ ...model })),
  recommendedModels: [...provider.recommendedModels],
});

const cloneRoute = (route: LlmAgentRoute): LlmAgentRoute => ({ ...route });

const computeConfigured = (provider: LlmProviderEntry): boolean => {
  if (!provider.enabled) return false;
  if (provider.kind === 'ollama') return true;
  return Boolean(provider.apiKey.trim());
};

const getEnabledModels = (provider?: Pick<LlmProviderEntry, 'models'> | null) =>
  provider?.models.filter((model) => model.enabled) ?? [];

const getProviderDisplayLabel = (
  provider: Pick<LlmProviderEntry, 'label'>,
  fallbackLabel: string,
): string => provider.label.trim() || fallbackLabel;

type ExtendedSettingsSection = SettingsSection | 'agents';

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, settings, onClose }) => {
  const { t } = useI18n();
  const setTheme = useAppSettingsStore((state) => state.setTheme);
  const setLanguage = useAppSettingsStore((state) => state.setLanguage);
  const setFontScale = useAppSettingsStore((state) => state.setFontScale);
  const updateProfile = useAppSettingsStore((state) => state.updateProfile);
  const updateWorkspaceRoot = useAppSettingsStore((state) => state.updateWorkspaceRoot);
  const resetWorkspaceRoot = useAppSettingsStore((state) => state.resetWorkspaceRoot);
  const saveProvider = useAppSettingsStore((state) => state.saveProvider);
  const removeProvider = useAppSettingsStore((state) => state.removeProvider);
  const saveAgentRoute = useAppSettingsStore((state) => state.saveAgentRoute);

  const [activeSection, setActiveSection] = useState<ExtendedSettingsSection>('models');
  const [accountDraft, setAccountDraft] = useState(settings.profile);
  const [workspaceDraft, setWorkspaceDraft] = useState(settings.workspace.rootPath);
  const [providerDrafts, setProviderDrafts] = useState<LlmProviderEntry[]>(settings.llm.providers.map(cloneProvider));
  const [agentRouteDrafts, setAgentRouteDrafts] = useState<LlmAgentRoute[]>(settings.llm.agentRoutes.map(cloneRoute));
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(settings.llm.providers[0]?.id ?? null);
  const [newModelId, setNewModelId] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (!open) return;
    setActiveSection('models');
    setAccountDraft(settings.profile);
    setWorkspaceDraft(settings.workspace.rootPath);
    const providers = settings.llm.providers.map(cloneProvider);
    setProviderDrafts(providers);
    setAgentRouteDrafts(settings.llm.agentRoutes.map(cloneRoute));
    setSelectedProviderId(providers[0]?.id ?? null);
    setNewModelId('');
    setShowApiKey(false);
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
  const builtinProviderIds = useMemo(
    () => new Set<string>(BUILTIN_LLM_PROVIDER_DEFINITIONS.map((provider) => provider.id)),
    [],
  );
  const isBuiltinSelectedProvider = selectedProvider ? builtinProviderIds.has(selectedProvider.id) : false;
  const routableProviders = useMemo(
    () => providerDrafts.filter((provider) => provider.enabled && provider.isConfigured && getEnabledModels(provider).length > 0),
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
  };

  const invalidAgentRoutes = useMemo(
    () => agentRouteDrafts.filter((route) => resolveAgentRouteStatus(route).issue !== null),
    [agentRouteDrafts, providerDrafts],
  );

  if (!open) return null;

  const handleAvatarSelect = async () => {
    const avatarPath = await window.electronAPI.appShell.selectAvatar();
    if (!avatarPath) return;
    setAccountDraft((current) => ({ ...current, avatarPath }));
  };

  const handleAccountSave = async () => {
    await updateProfile(accountDraft);
  };

  const handleWorkspacePick = async () => {
    const nextRoot = await window.electronAPI.selectDirectory();
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

  const handleProviderDraftChange = <K extends keyof LlmProviderEntry>(field: K, value: LlmProviderEntry[K]) => {
    if (!selectedProvider) return;
    setProviderDrafts((current) => current.map((provider) => {
      if (provider.id !== selectedProvider.id) {
        return provider;
      }
      const nextProvider = {
        ...provider,
        [field]: value,
      };
      return {
        ...nextProvider,
        isConfigured: computeConfigured(nextProvider),
      };
    }));
  };

  const handleAddProvider = () => {
    const nextProvider = createCustomProvider();
    setProviderDrafts((current) => [...current, nextProvider]);
    setSelectedProviderId(nextProvider.id);
  };

  const handleSaveProvider = async () => {
    if (!selectedProvider) return;
    const normalizedProvider = {
      ...selectedProvider,
      label: selectedProvider.label.trim(),
      apiKey: selectedProvider.apiKey.trim(),
      baseUrl: selectedProvider.baseUrl?.trim() || '',
      docsUrl: selectedProvider.docsUrl?.trim() || '',
      models: selectedProvider.models
        .filter((model) => model.id.trim())
        .map((model) => ({
          ...model,
          id: model.id.trim(),
          label: model.label.trim() || model.id.trim(),
        })),
      recommendedModels: Array.from(new Set(selectedProvider.recommendedModels.map((model) => model.trim()).filter(Boolean))),
      isConfigured: false,
    };
    normalizedProvider.isConfigured = computeConfigured(normalizedProvider);
    setProviderDrafts((current) => current.map((provider) => (
      provider.id === normalizedProvider.id ? normalizedProvider : provider
    )));
    await saveProvider(normalizedProvider);
  };

  const handleDeleteProvider = async () => {
    if (!selectedProvider) return;
    await removeProvider(selectedProvider.id);
    const remaining = providerDrafts.filter((provider) => provider.id !== selectedProvider.id);
    setProviderDrafts(remaining);
    setSelectedProviderId(remaining[0]?.id ?? null);
  };

  const handleAddModel = () => {
    if (!selectedProvider || !newModelId.trim()) return;
    const nextModelId = newModelId.trim();
    if (selectedProvider.models.some((model) => model.id === nextModelId)) {
      setNewModelId('');
      return;
    }
    handleProviderDraftChange('models', [
      ...selectedProvider.models,
      { id: nextModelId, label: nextModelId, enabled: true },
    ]);
    setNewModelId('');
  };

  const handleRemoveModel = (modelId: string) => {
    if (!selectedProvider) return;
    handleProviderDraftChange('models', selectedProvider.models.filter((model) => model.id !== modelId));
  };

  const handleAddRecommendedModel = (modelId: string) => {
    if (!selectedProvider || selectedProvider.models.some((model) => model.id === modelId)) {
      return;
    }
    handleProviderDraftChange('models', [
      ...selectedProvider.models,
      { id: modelId, label: modelId, enabled: true },
    ]);
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

  const sections: Array<{ id: ExtendedSettingsSection; label: string }> = [
    { id: 'account', label: t('settings.account') },
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
              <div className="settings-modal-title">{sections.find((section) => section.id === activeSection)?.label}</div>
              <div className="settings-modal-subtitle">
                {activeSection === 'account' && t('settings.accountSubtitle')}
                {activeSection === 'general' && t('settings.generalSubtitle')}
                {activeSection === 'workspace' && t('settings.workspaceSubtitle')}
                {activeSection === 'models' && t('settings.modelsSubtitle')}
                {activeSection === 'agents' && t('settings.agentsSubtitle')}
              </div>
            </div>
            <button type="button" className="settings-modal-close" onClick={onClose} aria-label="Close settings">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          <div className="settings-center-panel">
            {activeSection === 'account' && (
              <section className="settings-page settings-account-page">
                <div className="settings-account-avatar-row">
                  <div className="settings-account-avatar-shell">
                    {accountDraft.avatarPath ? (
                      <img className="settings-account-avatar" src={toFileUrl(accountDraft.avatarPath)} alt="avatar" />
                    ) : (
                      <div className="settings-account-avatar settings-account-avatar-fallback">
                        {(accountDraft.nickname || 'RA').trim().slice(0, 2).toUpperCase()}
                      </div>
                    )}
                  </div>
                  <div className="settings-account-avatar-copy">
                    <div className="settings-field-label">{t('settings.avatar')}</div>
                    <div className="settings-help-text">{t('settings.avatarHint')}</div>
                    <button type="button" className="button button-secondary" onClick={() => void handleAvatarSelect()}>
                      {t('settings.uploadAvatar')}
                    </button>
                  </div>
                </div>

                <label className="settings-field">
                  <span className="settings-field-label">{t('settings.nickname')}</span>
                  <input
                    className="input"
                    value={accountDraft.nickname}
                    onChange={(event) => setAccountDraft((current) => ({ ...current, nickname: event.target.value }))}
                  />
                </label>

                <div className="settings-actions">
                  <button type="button" className="button button-primary" onClick={() => void handleAccountSave()}>
                    {t('settings.save')}
                  </button>
                </div>
              </section>
            )}

            {activeSection === 'general' && (
              <section className="settings-page">
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
                      简体中文
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
              </section>
            )}

            {activeSection === 'workspace' && (
              <section className="settings-page">
                <div className="settings-workspace-hero">
                  <div className="settings-field-label">{t('settings.workspaceRoot')}</div>
                  <div className="settings-help-text">{t('settings.workspaceRootHint')}</div>
                  <div className="settings-path-value">{workspaceDraft || settings.paths.defaultWorkspaceRoot}</div>
                  <div className="settings-path-actions">
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
                    <button type="button" className="button button-secondary" onClick={() => void handleWorkspaceReset()}>
                      {t('settings.resetWorkspace')}
                    </button>
                    <button type="button" className="button button-primary" onClick={() => void handleWorkspaceSave()}>
                      {t('settings.save')}
                    </button>
                  </div>
                </div>

                <div className="settings-path-grid">
                  {[
                    { label: t('settings.settingsFile'), value: derivedPaths.settingsPath },
                    { label: t('settings.logFile'), value: derivedPaths.logPath },
                    { label: t('settings.projectsPath'), value: derivedPaths.projectsPath },
                    { label: t('settings.knowledgePath'), value: derivedPaths.knowledgePath },
                  ].map((entry) => (
                    <div key={entry.label} className="settings-path-card">
                      <div className="settings-field-label">{entry.label}</div>
                      <div className="settings-path-value">{entry.value}</div>
                      <div className="settings-path-actions">
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => void window.electronAPI.appShell.openPath(entry.value)}
                        >
                          {t('settings.reveal')}
                        </button>
                        <button
                          type="button"
                          className="button button-secondary"
                          onClick={() => void window.electronAPI.appShell.copyText(entry.value)}
                        >
                          {t('settings.copy')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {activeSection === 'models' && (
              <section className="settings-page settings-page-models">
                <div className="settings-models-page">
                <aside className="settings-provider-column">
                  <div className="settings-model-sidebar-title">{t('settings.modelSettings')}</div>
                  <div className="settings-column-title">{t('settings.provider')}</div>
                  <div className="settings-provider-list-wrap scrollbar-thin" data-testid="settings-provider-list">
                    <div className="settings-provider-list">
                      {providerDrafts.map((provider) => (
                        <button
                          key={provider.id}
                          type="button"
                          className={`settings-provider-item ${selectedProviderId === provider.id ? 'active' : ''}`}
                          onClick={() => setSelectedProviderId(provider.id)}
                        >
                          <div className="settings-provider-tile">
                            <div className="settings-provider-icon-shell">
                              <span className={`settings-provider-status ${provider.isConfigured ? 'configured' : 'pending'}`} />
                              <span className="settings-provider-icon">
                                {getResolvedProviderLabel(provider).slice(0, 1).toUpperCase()}
                              </span>
                            </div>
                            <span className="settings-provider-item-label">{getResolvedProviderLabel(provider)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-provider-toolbar">
                    <button
                      type="button"
                      className="settings-sidebar-icon-button"
                      data-testid="settings-provider-add"
                      onClick={handleAddProvider}
                      aria-label={t('settings.addProvider')}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="settings-sidebar-icon-button"
                      data-testid="settings-provider-delete"
                      onClick={() => void handleDeleteProvider()}
                      aria-label={t('settings.delete')}
                      disabled={!selectedProvider}
                    >
                      x
                    </button>
                  </div>
                </aside>

                <div className="settings-model-detail scrollbar-thin" data-testid="settings-model-detail">
                  {!selectedProvider ? (
                    <div className="settings-credential-empty settings-empty-state">
                      {providerDrafts.length === 0 ? (
                        <>
                          <div className="settings-field-label">{t('settings.emptyProvidersTitle')}</div>
                          <div className="settings-help-text">{t('settings.emptyProvidersHint')}</div>
                          <div className="settings-actions">
                            <button type="button" className="button button-primary" onClick={handleAddProvider}>
                              {t('settings.addProvider')}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div>{t('settings.noSelection')}</div>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="settings-provider-header">
                        <div>
                          <div className="settings-provider-title">{getResolvedProviderLabel(selectedProvider)}</div>
                          <div className="settings-provider-title-underline" />
                        </div>
                        <div className="settings-provider-header-state">
                          <span className={`settings-provider-status ${selectedProvider.isConfigured ? 'configured' : 'pending'}`} />
                          <span>{selectedProvider.isConfigured ? t('settings.providerConfigured') : t('settings.providerUnconfigured')}</span>
                          <label className="settings-switch">
                            <input
                              type="checkbox"
                              checked={selectedProvider.enabled}
                              onChange={(event) => handleProviderDraftChange('enabled', event.target.checked)}
                            />
                            <span className="settings-switch-track" />
                          </label>
                        </div>
                      </div>

                      {!isBuiltinSelectedProvider && (
                        <div className="settings-field-grid">
                          <label className="settings-field">
                            <span className="settings-field-label">{t('settings.label')}</span>
                            <input
                              className="input"
                              value={selectedProvider.label}
                              onChange={(event) => handleProviderDraftChange('label', event.target.value)}
                            />
                          </label>

                          <label className="settings-field">
                            <span className="settings-field-label">{t('settings.providerKind')}</span>
                            <select
                              className="input"
                              value={selectedProvider.kind}
                              onChange={(event) => handleProviderDraftChange('kind', event.target.value as LlmProviderKind)}
                            >
                              {PROVIDER_KIND_OPTIONS.map((kind) => (
                                <option key={kind} value={kind}>{kind}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}

                      <label className="settings-field">
                        <span className="settings-field-label">{t('settings.apiKey')}</span>
                        <div className="settings-secret-field">
                          <input
                            className="input settings-secret-input"
                            data-testid="settings-api-key-input"
                            type={showApiKey ? 'text' : 'password'}
                            value={selectedProvider.apiKey}
                            onChange={(event) => handleProviderDraftChange('apiKey', event.target.value)}
                          />
                          <button
                            type="button"
                            className="settings-secret-toggle"
                            data-testid="settings-api-key-toggle"
                            onClick={() => setShowApiKey((current) => !current)}
                            aria-label={showApiKey ? t('settings.hideSecret') : t('settings.showSecret')}
                          >
                            {showApiKey ? t('settings.hideSecret') : t('settings.showSecret')}
                          </button>
                        </div>
                      </label>

                      {selectedProvider.docsUrl && (
                        <a className="settings-link" href={selectedProvider.docsUrl} target="_blank" rel="noreferrer">
                          {t('settings.getApiKey')}
                        </a>
                      )}

                      <label className="settings-field">
                        <span className="settings-field-label">{t('settings.baseUrl')}</span>
                        <input
                          className="input"
                          value={selectedProvider.baseUrl ?? ''}
                          onChange={(event) => handleProviderDraftChange('baseUrl', event.target.value)}
                        />
                      </label>

                      <div className="settings-model-section">
                        <div className="settings-model-section-header">
                          <span>{t('settings.modelsEnabled')}</span>
                          <button type="button" className="settings-inline-link" onClick={handleAddModel}>
                            + {t('settings.addModel')}
                          </button>
                        </div>
                        <div className="settings-model-adder-row">
                          <input
                            className="input"
                            value={newModelId}
                            onChange={(event) => setNewModelId(event.target.value)}
                            placeholder={t('settings.addModelPlaceholder')}
                          />
                        </div>

                        <div className="settings-model-list">
                          {selectedProvider.models.map((model) => (
                            <div key={model.id} className="settings-model-row">
                              <span className="settings-model-row-check">✓</span>
                              <span className="settings-model-row-label">{model.label}</span>
                              <button type="button" className="settings-model-row-remove" onClick={() => handleRemoveModel(model.id)}>
                                ×
                              </button>
                            </div>
                          ))}
                        </div>

                        <div className="settings-recommend-header">{t('settings.recommendedModels')}</div>
                        <div className="settings-model-recommend-list">
                          {selectedProvider.recommendedModels.map((modelId) => (
                            <button
                              key={modelId}
                              type="button"
                              className="settings-model-recommend-row"
                              onClick={() => handleAddRecommendedModel(modelId)}
                            >
                              + {modelId}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="settings-actions">
                        <button
                          type="button"
                          className="button button-primary"
                          data-testid="settings-provider-save"
                          onClick={() => void handleSaveProvider()}
                        >
                          {t('settings.save')}
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
                    {routableProviders.length === 0 && (
                      <div className="settings-help-text">{t('settings.noConfiguredProviders')}</div>
                    )}
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
                          <div className="settings-agent-grid">
                            <label className="settings-field">
                              <span className="settings-field-label">{t('settings.providerFieldLabel')}</span>
                              <select
                                className="input"
                                data-testid={`settings-agent-provider-${agentId}`}
                                value={providerValue}
                                onChange={(event) => {
                                  const nextProviderId = event.target.value;
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
                              >
                                <option value="">
                                  {routableProviders.length === 0
                                    ? t('settings.noConfiguredProviders')
                                    : t('settings.selectProviderPlaceholder')}
                                </option>
                                {routableProviders.map((entry) => (
                                  <option key={entry.id} value={entry.id}>{getResolvedProviderLabel(entry)}</option>
                                ))}
                              </select>
                            </label>
                            <label className="settings-field">
                              <span className="settings-field-label">{t('settings.modelFieldLabel')}</span>
                              <select
                                className="input"
                                data-testid={`settings-agent-model-${agentId}`}
                                value={modelValue}
                                onChange={(event) => handleRouteChange(agentId, { modelId: event.target.value })}
                                disabled={!selectedRouteProvider || availableModels.length === 0}
                              >
                                {!selectedRouteProvider && <option value="">{t('settings.selectProviderFirst')}</option>}
                                {selectedRouteProvider && availableModels.length === 0 && (
                                  <option value="">{t('settings.noModelsAvailable')}</option>
                                )}
                                {availableModels.map((model) => (
                                  <option key={model.id} value={model.id}>{model.label}</option>
                                ))}
                              </select>
                            </label>
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
    </div>,
    document.body,
  );
};

export default SettingsModal;
