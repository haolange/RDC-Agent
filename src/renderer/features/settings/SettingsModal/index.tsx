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
  LlmProviderAccountStatus,
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
  baseUrl: string;
  showApiKey: boolean;
  usingStoredSecret: boolean;
  busy: ProviderConnectionBusyState;
  error: string;
  testedApiKey: string;
  models: LlmProviderModel[];
  accountStatus?: LlmProviderAccountStatus;
  authCode: string;
}

const STORED_SECRET_MASK = '••••••••••••••••••••••••';

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
  if (provider.catalogGroup === 'environment') return 'Environment';
  return 'API Key';
};

const getProviderStatusLabel = (provider: Pick<LlmProviderEntry, 'status' | 'isConfigured'>): TranslationKey => {
  if (provider.status === 'verified' && provider.isConfigured) return 'settings.providerConnected';
  if (provider.status === 'failed') return 'settings.providerFailed';
  if (provider.status === 'unavailable') return 'settings.providerUnavailable';
  return 'settings.providerUnconfigured';
};

const getModelSummary = (models: LlmProviderModel[], fallback: string): string => {
  if (models.length === 0) return fallback;
  if (models.length <= 2) return models.map((model) => model.label).join(', ');
  return `${models.slice(0, 2).map((model) => model.label).join(', ')} +${models.length - 2}`;
};

const sortProvidersByLabel = (providers: LlmProviderEntry[]): LlmProviderEntry[] =>
  [...providers].sort((left, right) => (
    getProviderDisplayLabel(left, left.id).localeCompare(
      getProviderDisplayLabel(right, right.id),
      undefined,
      { sensitivity: 'base' },
    )
  ));

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return fallback;
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

  const connectionProvider = useMemo(
    () => providerDrafts.find((provider) => provider.id === connectionDraft?.providerId) ?? null,
    [connectionDraft?.providerId, providerDrafts],
  );
  const routableProviders = useMemo(
    () => sortProvidersByLabel(providerDrafts.filter((provider) => provider.enabled && provider.isConfigured && getEnabledModels(provider).length > 0)),
    [providerDrafts],
  );
  const accountProviders = useMemo(
    () => sortProvidersByLabel(providerDrafts.filter((provider) => provider.authMode === 'account')),
    [providerDrafts],
  );
  const providerCatalog = useMemo(
    () => sortProvidersByLabel(providerDrafts.filter((provider) => provider.authMode !== 'account')),
    [providerDrafts],
  );
  const configuredProvidersWithoutEnabledModels = useMemo(
    () => sortProvidersByLabel(providerDrafts.filter((provider) => provider.enabled && provider.isConfigured && getEnabledModels(provider).length === 0)),
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

  useEffect(() => {
    if (
      !open
      || !connectionDraft
      || connectionProvider?.authMode !== 'account'
      || connectionDraft.accountStatus?.state !== 'pending'
    ) {
      return;
    }

    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        const status = await window.electronAPI.llm.getProviderAccountStatus(connectionDraft.providerId);
        if (cancelled) {
          return;
        }
        if (status.connected) {
          const nextSettings = await reloadSettings();
          if (cancelled) {
            return;
          }
          const nextProviders = nextSettings.llm.providers.map(cloneProvider);
          setProviderDrafts(nextProviders);
          setAgentRouteDrafts(nextSettings.llm.agentRoutes.map(cloneRoute));
          setSelectedProviderId(
            nextProviders.some((provider) => provider.id === connectionDraft.providerId)
              ? connectionDraft.providerId
              : nextProviders[0]?.id ?? null,
          );
          setConnectionDraft(null);
          return;
        }
        setConnectionDraft((current) => current && current.providerId === connectionDraft.providerId
          ? { ...current, accountStatus: status, error: status.error ?? '' }
          : current);
      })();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    connectionDraft?.accountStatus?.state,
    connectionDraft?.providerId,
    connectionProvider?.authMode,
    open,
    reloadSettings,
  ]);

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
    const models = getEnabledModels(provider);
    setConnectionDraft({
      providerId: provider.id,
      apiKey: '',
      baseUrl: provider.baseUrl ?? '',
      showApiKey: false,
      usingStoredSecret: provider.authMode === 'api-key' && provider.hasStoredSecret,
      busy: 'idle',
      error: '',
      testedApiKey: '',
      models,
      accountStatus: provider.authMode === 'account' && provider.isConfigured
        ? {
          providerId: provider.id,
          state: 'connected',
          available: true,
          connected: true,
          accountLabel: provider.accountLabel,
          planLabel: provider.planLabel,
          expiresAt: provider.oauthExpiresAt,
          models,
        }
        : undefined,
      authCode: '',
    });
  };

  const updateConnectionDraft = (patch: Partial<ProviderConnectionDraft>) => {
    setConnectionDraft((current) => current ? { ...current, ...patch } : current);
  };

  const handleTestProviderDraft = async () => {
    if (!connectionDraft) return;
    updateConnectionDraft({ busy: 'testing', error: '', models: [] });
    try {
      if (connectionProvider?.authMode === 'account') {
        const result = await window.electronAPI.llm.refreshProviderModels(connectionDraft.providerId);
        if (!result.success) {
          updateConnectionDraft({ busy: 'idle', error: result.error ?? t('settings.providerTestFailed'), models: [] });
          return;
        }
        updateConnectionDraft({
          busy: 'idle',
          error: '',
          models: result.models,
        });
        await refreshLocalSettings(connectionDraft.providerId);
        return;
      }
      const result = await window.electronAPI.llm.testProviderDraft({
        providerId: connectionDraft.providerId,
        apiKey: connectionDraft.usingStoredSecret ? '' : connectionDraft.apiKey,
        baseUrl: connectionDraft.baseUrl,
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
    } catch (error) {
      updateConnectionDraft({
        busy: 'idle',
        error: getErrorMessage(error, t('settings.providerTestFailed')),
        models: [],
      });
    }
  };

  const handleSaveProviderConnection = async () => {
    if (!connectionDraft) return;
    updateConnectionDraft({ busy: 'saving', error: '' });
    try {
      if (connectionProvider?.authMode === 'account') {
        if (connectionProvider.isConfigured && !connectionDraft.accountStatus?.requiresCodeInput) {
          setConnectionDraft(null);
          return;
        }
        const status = connectionDraft.accountStatus?.requiresCodeInput
          ? await window.electronAPI.llm.finishProviderAccountLogin({
            providerId: connectionDraft.providerId,
            code: connectionDraft.authCode,
          })
          : await window.electronAPI.llm.startProviderAccountLogin(connectionDraft.providerId);
        if (!status.connected && status.state !== 'pending') {
          updateConnectionDraft({ busy: 'idle', error: status.error ?? status.message ?? t('settings.providerSaveFailed'), accountStatus: status });
          return;
        }
        if (status.connected) {
          await refreshLocalSettings(connectionDraft.providerId);
          setConnectionDraft(null);
          return;
        }
        updateConnectionDraft({ busy: 'idle', error: '', accountStatus: status });
        return;
      }
      const result = await window.electronAPI.llm.connectProvider({
        providerId: connectionDraft.providerId,
        apiKey: connectionDraft.usingStoredSecret ? '' : connectionDraft.apiKey,
        baseUrl: connectionDraft.baseUrl,
      });
      if (!result.success) {
        updateConnectionDraft({ busy: 'idle', error: result.error ?? t('settings.providerSaveFailed'), models: [] });
        return;
      }
      await refreshLocalSettings(connectionDraft.providerId);
      setConnectionDraft(null);
    } catch (error) {
      updateConnectionDraft({
        busy: 'idle',
        error: getErrorMessage(error, t('settings.providerSaveFailed')),
      });
    }
  };

  const handleStartAccountLogin = async () => {
    if (!connectionDraft) return;
    updateConnectionDraft({ busy: 'saving', error: '' });
    try {
      const status = await window.electronAPI.llm.startProviderAccountLogin(connectionDraft.providerId);
      updateConnectionDraft({
        busy: 'idle',
        error: status.error ?? '',
        accountStatus: status,
      });
      if (status.connected) {
        await refreshLocalSettings(connectionDraft.providerId);
        setConnectionDraft(null);
      }
    } catch (error) {
      updateConnectionDraft({
        busy: 'idle',
        error: getErrorMessage(error, t('settings.providerSaveFailed')),
      });
    }
  };

  const handleRefreshProviderModels = async (provider: LlmProviderEntry) => {
    setProviderDrafts((current) => current.map((entry) => (
      entry.id === provider.id ? { ...entry, status: 'unconfigured', lastError: '' } : entry
    )));
    try {
      const result = await window.electronAPI.llm.refreshProviderModels(provider.id);
      if (!result.success) {
        setProviderDrafts((current) => current.map((entry) => (
          entry.id === provider.id ? { ...entry, status: 'failed', lastError: result.error } : entry
        )));
        return;
      }
      await refreshLocalSettings(provider.id);
    } catch (error) {
      setProviderDrafts((current) => current.map((entry) => (
        entry.id === provider.id ? { ...entry, status: 'failed', lastError: getErrorMessage(error, t('settings.providerTestFailed')) } : entry
      )));
    }
  };

  const handleDisconnectProvider = async (provider: LlmProviderEntry) => {
    try {
      if (provider.authMode === 'account') {
        const status = await window.electronAPI.llm.logoutProviderAccount(provider.id);
        if (status.error) {
          setProviderDrafts((current) => current.map((entry) => (
            entry.id === provider.id ? { ...entry, status: 'failed', lastError: status.error } : entry
          )));
          return;
        }
        await refreshLocalSettings(provider.id);
        return;
      }
      const result = await window.electronAPI.llm.disconnectProvider(provider.id);
      if (!result.success) {
        setProviderDrafts((current) => current.map((entry) => (
          entry.id === provider.id ? { ...entry, status: 'failed', lastError: result.error } : entry
        )));
        return;
      }
      await refreshLocalSettings(provider.id);
    } catch (error) {
      setProviderDrafts((current) => current.map((entry) => (
        entry.id === provider.id ? { ...entry, status: 'failed', lastError: getErrorMessage(error, t('settings.providerSaveFailed')) } : entry
      )));
    }
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
  const connectionNeedsBaseUrl = Boolean(
    connectionDraft
    && connectionProvider?.baseUrlEditable
    && !connectionDraft.baseUrl.trim(),
  );
  const connectionHasFreshTest = Boolean(
    connectionDraft
    && connectionDraft.models.length > 0
    && connectionDraft.testedApiKey === connectionDraft.apiKey,
  );
  const connectionAccountConnected = Boolean(
    connectionDraft
    && connectionProvider?.authMode === 'account'
    && connectionProvider.isConfigured
    && connectionDraft.accountStatus?.connected,
  );

  const sections: Array<{ id: SettingsSection; label: string }> = [
    { id: 'general', label: t('settings.general') },
    { id: 'workspace', label: t('settings.workspace') },
    { id: 'models', label: t('settings.models') },
    { id: 'agents', label: t('settings.agents') },
  ];

  const renderProviderRow = (provider: LlmProviderEntry, mode: 'account' | 'connected' | 'add') => {
    const models = getEnabledModels(provider);
    const connected = provider.isConfigured && provider.status === 'verified';
    return (
      <div
        key={provider.id}
        className={`settings-provider-row ${connected ? 'connected' : ''}`}
        data-testid={`settings-${mode === 'account' ? 'oauth-row' : 'provider-row'}-${provider.id}`}
      >
        <div className="settings-provider-row-main">
          <span className={`settings-provider-status ${connected ? 'configured' : 'pending'}`} />
          <span className="settings-provider-icon">{getResolvedProviderLabel(provider).slice(0, 1).toUpperCase()}</span>
          <span className="settings-provider-row-copy">
            <span className="settings-provider-item-label">{getResolvedProviderLabel(provider)}</span>
            <span className="settings-provider-item-meta">
              {provider.authMode === 'account'
                ? [
                  t(getProviderStatusLabel(provider)),
                  provider.accountLabel,
                  provider.planLabel,
                  getModelSummary(models, ''),
                ].filter(Boolean).join(' · ')
                : [
                  getProviderGroupLabel(provider),
                  connected ? t('settings.providerConnected') : t('settings.providerUnconfigured'),
                  getModelSummary(models, t('settings.noEnabledModels')),
                ].filter(Boolean).join(' · ')}
            </span>
          </span>
        </div>
        <div className="settings-provider-row-actions">
          {(mode !== 'add' || provider.isConfigured) && (
            <button
              type="button"
              className="button button-secondary settings-provider-row-button"
              data-testid={`settings-provider-test-${provider.id}`}
              onClick={() => void handleRefreshProviderModels(provider)}
              disabled={!provider.isConfigured}
            >
              {t('settings.test')}
            </button>
          )}
          {(mode !== 'add' || provider.isConfigured) && (
            <button
              type="button"
              className="button button-secondary settings-provider-row-button"
              data-testid={`settings-provider-disconnect-${provider.id}`}
              onClick={() => void handleDisconnectProvider(provider)}
              disabled={!provider.isConfigured}
            >
              {provider.authMode === 'account' ? t('settings.signOut') : t('settings.disconnect')}
            </button>
          )}
          <button
            type="button"
            className="button button-primary settings-provider-row-button"
            data-testid={`settings-provider-connect-${provider.id}`}
            onClick={() => openProviderConnection(provider)}
          >
            {provider.isConfigured ? t('settings.edit') : t('settings.connect')}
          </button>
        </div>
      </div>
    );
  };

  const renderProviderGroup = (
    title: string,
    subtitle: string,
    providers: LlmProviderEntry[],
    testId: string,
    mode: 'account' | 'connected' | 'add',
  ) => (
    <div className="settings-provider-section settings-provider-section-flat" data-testid={testId}>
      <div className="settings-section-header">
        <div>
          <div className="settings-section-title">{title}</div>
          <div className="settings-section-subtitle">{subtitle}</div>
        </div>
      </div>
      <div className="settings-provider-row-list" data-empty-label={t('settings.noProvidersInGroup')}>
        {providers.map((provider) => renderProviderRow(provider, mode))}
      </div>
    </div>
  );

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
                  {renderProviderGroup(
                    t('settings.oauthAccounts'),
                    t('settings.oauthAccountsHint'),
                    accountProviders,
                    'settings-oauth-accounts',
                    'account',
                  )}
                  {renderProviderGroup(
                    t('settings.addProvider'),
                    t('settings.addProviderHint'),
                    providerCatalog,
                    'settings-add-provider',
                    'add',
                  )}
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
              <>
                {connectionProvider.baseUrlEditable && (
                  <label className="settings-field">
                    <span className="settings-field-label">{t('settings.providerBaseUrl')}</span>
                    <input
                      className="input"
                      data-testid="settings-provider-connect-base-url"
                      value={connectionDraft.baseUrl}
                      onChange={(event) => updateConnectionDraft({
                        baseUrl: event.target.value,
                        error: '',
                        testedApiKey: '',
                        models: [],
                      })}
                    />
                  </label>
                )}
                <label className="settings-field">
                  <span className="settings-field-label">{t('settings.apiKey')}</span>
                  <div className="settings-secret-field">
                    <input
                      className="input settings-secret-input"
                      data-testid="settings-provider-connect-api-key"
                      type={connectionDraft.showApiKey && !connectionDraft.usingStoredSecret ? 'text' : 'password'}
                      value={connectionDraft.usingStoredSecret ? STORED_SECRET_MASK : connectionDraft.apiKey}
                      placeholder=""
                      onFocus={() => {
                        if (connectionDraft.usingStoredSecret) {
                          updateConnectionDraft({ usingStoredSecret: false, apiKey: '', showApiKey: false });
                        }
                      }}
                      onChange={(event) => updateConnectionDraft({
                        apiKey: event.target.value,
                        usingStoredSecret: false,
                        error: '',
                        testedApiKey: '',
                        models: [],
                      })}
                    />
                    <button
                      type="button"
                      className="settings-secret-toggle"
                      data-testid="settings-provider-connect-api-key-toggle"
                      onClick={() => {
                        if (connectionDraft.usingStoredSecret) {
                          updateConnectionDraft({ usingStoredSecret: false, apiKey: '', showApiKey: false });
                          return;
                        }
                        updateConnectionDraft({ showApiKey: !connectionDraft.showApiKey });
                      }}
                      aria-label={connectionDraft.usingStoredSecret ? t('settings.replaceSecret') : connectionDraft.showApiKey ? t('settings.hideSecret') : t('settings.showSecret')}
                      disabled={!connectionDraft.usingStoredSecret && !connectionDraft.apiKey}
                    >
                      {connectionDraft.usingStoredSecret
                        ? t('settings.replaceSecret')
                        : connectionDraft.showApiKey ? t('settings.hideSecret') : t('settings.showSecret')}
                    </button>
                  </div>
                  <span className="settings-help-text">
                    {connectionProvider.hasStoredSecret ? t('settings.apiKeyStoredHint') : t('settings.apiKeyConnectHint')}
                  </span>
                </label>
              </>
            )}

            {connectionProvider.authMode === 'local' && (
              <div className="settings-provider-notice">
                {t('settings.localProviderConnectHint')}
              </div>
            )}

            {connectionProvider.authMode === 'environment' && (
              <div className="settings-provider-notice" data-testid="settings-provider-environment-notice">
                {t('settings.environmentProviderConnectHint')}
              </div>
            )}

            {connectionProvider.authMode === 'account' && (
              <div className="settings-provider-oauth-panel">
                <div className="settings-provider-notice">
                  {connectionAccountConnected
                    ? t('settings.oauthConnectedHint')
                    : connectionDraft.accountStatus?.message || t('settings.oauthConnectHint')}
                </div>
                {connectionAccountConnected && (connectionDraft.accountStatus?.accountLabel || connectionDraft.accountStatus?.planLabel) && (
                  <div className="settings-secret-status" data-testid="settings-provider-oauth-summary">
                    <span>{[connectionDraft.accountStatus.accountLabel, connectionDraft.accountStatus.planLabel].filter(Boolean).join(' · ')}</span>
                  </div>
                )}
                {!connectionAccountConnected && (
                  <button
                    type="button"
                    className="button button-secondary"
                    data-testid="settings-provider-oauth-start"
                    onClick={() => void handleStartAccountLogin()}
                    disabled={connectionDraft.busy !== 'idle'}
                  >
                    {t('settings.connect')}
                  </button>
                )}
                {!connectionAccountConnected && connectionDraft.accountStatus?.authUrl && (
                  <a className="settings-link" href={connectionDraft.accountStatus.authUrl} target="_blank" rel="noreferrer">
                    {t('settings.openAuthPage')}
                  </a>
                )}
                {!connectionAccountConnected && connectionDraft.accountStatus?.verificationUri && (
                  <div className="settings-secret-status">
                    <span>{connectionDraft.accountStatus.verificationUri}</span>
                    <strong data-testid="settings-provider-oauth-device-code">
                      {connectionDraft.accountStatus.userCode}
                    </strong>
                  </div>
                )}
                {!connectionAccountConnected && connectionDraft.accountStatus?.requiresCodeInput && (
                  <label className="settings-field">
                    <span className="settings-field-label">{t('settings.oauthCode')}</span>
                    <input
                      className="input"
                      data-testid="settings-provider-oauth-code"
                      value={connectionDraft.authCode}
                      onChange={(event) => updateConnectionDraft({ authCode: event.target.value, error: '' })}
                    />
                  </label>
                )}
              </div>
            )}

            {connectionProvider.docsUrl && (
              <a className="settings-link" href={connectionProvider.docsUrl} target="_blank" rel="noreferrer">
                {connectionProvider.authMode === 'local' || connectionProvider.authMode === 'account' || connectionProvider.authMode === 'environment' ? t('settings.providerDocs') : t('settings.getApiKey')}
              </a>
            )}

            {connectionDraft.error && (
              <div className="settings-provider-notice error" data-testid="settings-provider-connect-error">
                {connectionDraft.error}
              </div>
            )}

            <div className="settings-model-section settings-provider-connect-models" data-testid="settings-provider-connect-models">
              <div className="settings-model-section-header">
                <span>{connectionProvider.modelDiscovery === 'anthropic-candidate-validation' || connectionProvider.modelDiscovery === 'azure-openai'
                  ? t('settings.verifiedModels')
                  : connectionProvider.modelDiscovery === 'static'
                    ? t('settings.builtinModels')
                    : t('settings.discoveredModels')}</span>
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
                disabled={connectionDraft.busy !== 'idle' || connectionNeedsApiKey || connectionNeedsBaseUrl}
              >
                {connectionDraft.busy === 'testing' ? t('settings.testing') : t('settings.test')}
              </button>
              <button
                type="button"
                className="button button-primary"
                data-testid="settings-provider-connect-save"
                onClick={() => void handleSaveProviderConnection()}
                disabled={connectionDraft.busy !== 'idle' || connectionNeedsApiKey || connectionNeedsBaseUrl}
              >
                {connectionDraft.busy === 'saving'
                  ? t('settings.saving')
                  : connectionProvider.authMode === 'account'
                    ? connectionProvider.isConfigured
                      ? t('settings.save')
                      : t('settings.connect')
                    : connectionHasFreshTest
                    ? t('settings.save')
                    : t('settings.connect')}
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
