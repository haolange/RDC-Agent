import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { AppSettings } from '@shared/types/settings';
import { useSettingsModal } from './useSettingsModal';
import { GeneralSettings } from './sections/GeneralSettings';
import { WorkspaceSettings } from './sections/WorkspaceSettings';
import { ModelsSettings } from './sections/ModelsSettings';
import { SkillsAgentsSettings } from './sections/SkillsAgentsSettings';
import { ToolsSettings } from './sections/ToolsSettings';
import { ProviderConnectDialog } from './sections/ProviderConnectDialog';
import { SettingsNavIcon } from './SettingsNavIcon';
import './SettingsModal.css';

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, settings, onClose }) => {
  const modal = useSettingsModal(open, settings);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const {
    t,
    activeSection,
    setActiveSection,
    sections,
    accountDraft,
    setAccountDraft,
    workspaceDraft,
    enabledMcpDrafts,
    setEnabledMcpDrafts,
    rdxCliDraft,
    setRdxCliDraft,
    rdxActionsDraft,
    setRdxActionsDraft,
    agentManifestDrafts,
    setAgentManifestDrafts,
    globalInstructionsDraft,
    setGlobalInstructionsDraft,
    connectionDraft,
    setConnectionDraft,
    agentManifestSaveState,
    agentManifestSaveMessage,
    derivedPathEntries,
    accountProviders,
    providerCatalog,
    providerCatalogCategories,
    getResolvedProviderLabel,
    handleAvatarSelect,
    handleAccountSave,
    handleWorkspacePick,
    handleWorkspaceSave,
    handleWorkspaceReset,
    handleRefreshProviderModels,
    handleDisconnectProvider,
    handleSaveAgentManifests,
    handleImportAgentManifest,
    handleSaveToolsConfig,
    handleSavePersonalization,
    handleUpsertSkill,
    handleDeleteSkill,
    handleImportSkill,
    handleUpsertMcpServer,
    handleDeleteMcpServer,
    handleImportMcpServer,
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

  useEffect(() => {
    if (!open) return;
    panelRef.current?.scrollTo({ top: 0, left: 0 });
  }, [activeSection, open]);

  if (!open) return null;

  const subtitle = (() => {
    switch (activeSection) {
      case 'general':
        return t('settings.generalSubtitle');
      case 'workspace':
        return t('settings.workspaceSubtitle');
      case 'models':
        return t('settings.modelsSubtitle');
      case 'skillsAgents':
        return '';
      case 'tools':
        return '';
      default:
        return '';
    }
  })();

  return createPortal(
    <>
      <div className="settings-modal-backdrop" onClick={onClose}>
        <div
          className="settings-modal settings-center"
          data-testid="settings-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
          aria-describedby={subtitle ? 'settings-modal-subtitle' : undefined}
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
                  <SettingsNavIcon section={section.id} />
                  <span>{section.label}</span>
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
                {subtitle ? (
                  <div className="settings-modal-subtitle" id="settings-modal-subtitle">
                    {subtitle}
                  </div>
                ) : null}
              </div>
              <button type="button" className="settings-modal-close" onClick={onClose} aria-label={t('settings.close')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div ref={panelRef} className="settings-center-panel scrollbar-thin" data-testid="settings-center-panel">
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
                  globalInstructionsDraft={globalInstructionsDraft}
                  onGlobalInstructionsDraftChange={setGlobalInstructionsDraft}
                  onSavePersonalization={handleSavePersonalization}
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
                  providerCatalogCategories={providerCatalogCategories}
                  getResolvedProviderLabel={getResolvedProviderLabel}
                  onRefreshProviderModels={handleRefreshProviderModels}
                  onDisconnectProvider={handleDisconnectProvider}
                  onOpenProviderConnection={openProviderConnection}
                  t={t}
                />
              )}

              {activeSection === 'skillsAgents' && (
                <SkillsAgentsSettings
                  settings={settings}
                  onUpsertSkill={handleUpsertSkill}
                  onDeleteSkill={handleDeleteSkill}
                  onImportSkill={handleImportSkill}
                  agentManifestDrafts={agentManifestDrafts}
                  onAgentManifestDraftsChange={setAgentManifestDrafts}
                  onRetrySaveAgentManifests={handleSaveAgentManifests}
                  onImportAgentManifest={handleImportAgentManifest}
                  agentManifestSaveState={agentManifestSaveState}
                  agentManifestSaveMessage={agentManifestSaveMessage}
                  t={t}
                />
              )}

              {activeSection === 'tools' && (
                <ToolsSettings
                  settings={settings}
                  enabledMcpDrafts={enabledMcpDrafts}
                  rdxCliDraft={rdxCliDraft}
                  rdxActionsDraft={rdxActionsDraft}
                  onEnabledMcpDraftsChange={setEnabledMcpDrafts}
                  onRdxCliDraftChange={setRdxCliDraft}
                  onRdxActionsDraftChange={setRdxActionsDraft}
                  onSaveToolsConfig={handleSaveToolsConfig}
                  onUpsertMcpServer={handleUpsertMcpServer}
                  onDeleteMcpServer={handleDeleteMcpServer}
                  onImportMcpServer={handleImportMcpServer}
                  toggleRuntimeId={toggleRuntimeId}
                  t={t}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {connectionDraft && connectionProvider && (
        <ProviderConnectDialog
          connectionDraft={connectionDraft}
          connectionProvider={connectionProvider}
          getResolvedProviderLabel={getResolvedProviderLabel}
          providerCatalogCategories={providerCatalogCategories}
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
    </>,
    document.body,
  );
};

export default SettingsModal;
