import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { AppSettings } from '@shared/types/settings';
import { useSettingsModal } from './useSettingsModal';
import { GeneralSettings } from './sections/GeneralSettings';
import { WorkspaceSettings } from './sections/WorkspaceSettings';
import { ModelsSettings } from './sections/ModelsSettings';
import { AgentsSettings } from './sections/AgentsSettings';
import { ProviderConnectDialog } from './sections/ProviderConnectDialog';
import './SettingsModal.css';

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, settings, onClose }) => {
  const modal = useSettingsModal(open, settings);
  const {
    t,
    activeSection,
    setActiveSection,
    sections,
    accountDraft,
    setAccountDraft,
    workspaceDraft,
    providerDrafts,
    agentRouteDrafts,
    activeModeProfileDraft,
    setActiveModeProfileDraft,
    enabledSkillDrafts,
    setEnabledSkillDrafts,
    enabledMcpDrafts,
    setEnabledMcpDrafts,
    patternBindingDrafts,
    setPatternBindingDrafts,
    rdxCliDraft,
    setRdxCliDraft,
    connectionDraft,
    setConnectionDraft,
    agentRouteSaveState,
    agentRouteSaveMessage,
    derivedPathEntries,
    routableProviders,
    accountProviders,
    providerCatalog,
    configuredProvidersWithoutEnabledModels,
    getResolvedProviderLabel,
    handleAvatarSelect,
    handleAccountSave,
    handleWorkspacePick,
    handleWorkspaceSave,
    handleWorkspaceReset,
    handleRefreshProviderModels,
    handleDisconnectProvider,
    handleRouteChange,
    handleSaveAgentRoutes,
    handleSaveAgentRuntimeConfig,
    setTheme,
    setLanguage,
    setFontScale,
    toggleRuntimeId,
    connectionProvider,
    openProviderConnection,
    updateConnectionDraft,
    connectionNeedsApiKey,
    connectionNeedsBaseUrl,
    connectionHasFreshTest,
    connectionAccountConnected,
    connectionDevicePending,
    handleTestProviderDraft,
    handleSaveProviderConnection,
    handleStartAccountLogin,
  } = modal;

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const subtitle = (() => {
    switch (activeSection) {
      case 'general':
        return t('settings.generalSubtitle');
      case 'workspace':
        return t('settings.workspaceSubtitle');
      case 'models':
        return t('settings.modelsSubtitle');
      case 'agents':
        return t('settings.agentsSubtitle');
      default:
        return '';
    }
  })();

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
              <div className="settings-modal-title" id="settings-modal-title">
                {sections.find((section) => section.id === activeSection)?.label}
              </div>
              <div className="settings-modal-subtitle" id="settings-modal-subtitle">
                {subtitle}
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
              <GeneralSettings
                settings={settings}
                accountDraft={accountDraft}
                onAccountDraftChange={setAccountDraft}
                onAvatarSelect={handleAvatarSelect}
                onAccountSave={handleAccountSave}
                onThemeChange={setTheme}
                onLanguageChange={setLanguage}
                onFontScaleChange={setFontScale}
                t={t}
              />
            )}

            {activeSection === 'workspace' && (
              <WorkspaceSettings
                settings={settings}
                workspaceDraft={workspaceDraft}
                derivedPathEntries={derivedPathEntries}
                onWorkspacePick={handleWorkspacePick}
                onWorkspaceSave={handleWorkspaceSave}
                onWorkspaceReset={handleWorkspaceReset}
                t={t}
              />
            )}

            {activeSection === 'models' && (
              <ModelsSettings
                accountProviders={accountProviders}
                providerCatalog={providerCatalog}
                getResolvedProviderLabel={getResolvedProviderLabel}
                onRefreshProviderModels={handleRefreshProviderModels}
                onDisconnectProvider={handleDisconnectProvider}
                onOpenProviderConnection={openProviderConnection}
                t={t}
              />
            )}

            {activeSection === 'agents' && (
              <AgentsSettings
                settings={settings}
                providerDrafts={providerDrafts}
                agentRouteDrafts={agentRouteDrafts}
                activeModeProfileDraft={activeModeProfileDraft}
                enabledSkillDrafts={enabledSkillDrafts}
                enabledMcpDrafts={enabledMcpDrafts}
                patternBindingDrafts={patternBindingDrafts}
                rdxCliDraft={rdxCliDraft}
                routableProviders={routableProviders}
                configuredProvidersWithoutEnabledModels={configuredProvidersWithoutEnabledModels}
                getResolvedProviderLabel={getResolvedProviderLabel}
                onRouteChange={handleRouteChange}
                onActiveModeProfileChange={setActiveModeProfileDraft}
                onEnabledSkillDraftsChange={setEnabledSkillDrafts}
                onEnabledMcpDraftsChange={setEnabledMcpDrafts}
                onPatternBindingDraftsChange={setPatternBindingDrafts}
                onRdxCliDraftChange={setRdxCliDraft}
                onSaveAgentRoutes={handleSaveAgentRoutes}
                onSaveAgentRuntimeConfig={handleSaveAgentRuntimeConfig}
                toggleRuntimeId={toggleRuntimeId}
                agentRouteSaveState={agentRouteSaveState}
                agentRouteSaveMessage={agentRouteSaveMessage}
                t={t}
              />
            )}
          </div>
        </div>
      </div>

      {connectionDraft && connectionProvider && (
        <ProviderConnectDialog
          connectionDraft={connectionDraft}
          connectionProvider={connectionProvider}
          getResolvedProviderLabel={getResolvedProviderLabel}
          connectionAccountConnected={connectionAccountConnected}
          connectionDevicePending={connectionDevicePending}
          connectionNeedsApiKey={connectionNeedsApiKey}
          connectionNeedsBaseUrl={connectionNeedsBaseUrl}
          connectionHasFreshTest={connectionHasFreshTest}
          onClose={() => setConnectionDraft(null)}
          onUpdateConnectionDraft={updateConnectionDraft}
          onTest={handleTestProviderDraft}
          onSave={handleSaveProviderConnection}
          onStartAccountLogin={handleStartAccountLogin}
          t={t}
        />
      )}
    </div>,
    document.body,
  );
};

export default SettingsModal;
