import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppSettings } from '@shared/types/settings';
import { useSettingsModal } from './useSettingsModal';
import { GeneralSettings } from './sections/GeneralSettings';
import { WorkspaceSettings } from './sections/WorkspaceSettings';
import { ModelsSettings } from './sections/ModelsSettings';
import { AgentsSettings } from './sections/AgentsSettings';
import { ToolsSettings } from './sections/ToolsSettings';
import { McpStatusDashboard } from './sections/McpStatusDashboard';
import { ProviderConnectDialog } from './sections/ProviderConnectDialog';
import { SettingsNavIcon } from './SettingsNavIcon';
import { useRdxRuntimeOverview } from './useRdxRuntimeOverview';
import { RuntimeScopePanel } from './sections/RuntimeScopePanel';
import { HooksSettings } from './sections/HooksSettings';
import { PolicySettings } from './sections/PolicySettings';
import './SettingsModal.css';

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, settings, onClose }) => {
  const modal = useSettingsModal(open, settings);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const runtime = useRdxRuntimeOverview(open);
  const [resourceScope, setResourceScope] = useState<'user' | 'project'>('user');
  const {
    t,
    activeSection,
    setActiveSection,
    sections,
    accountDraft,
    setAccountDraft,
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
    accountProviders,
    providerCatalog,
    providerCatalogCategories,
    getResolvedProviderLabel,
    handleAvatarSelect,
    handleAccountSave,
    handleRefreshProviderModels,
    handleDisconnectProvider,
    handleSaveAgentManifests,
    handleImportAgentManifest,
    handleSaveToolsConfig,
    handleSavePersonalization,
    setTheme,
    setLanguage,
    setFontScale,
    setComposerMarkdown,
    setUsePointerCursors,
    connectionProvider,
    openProviderConnection,
    updateConnectionDraft,
    updateConnectionModelPreference,
    connectionNeedsCredentials,
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
      if (event.key === 'Escape' && !document.querySelector('[data-confirmation-dialog]')) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.scrollTo({ top: 0, left: 0 });
  }, [activeSection, open]);

  if (!open) return null;

  return createPortal(
    <>
      <div className="settings-modal-backdrop" onClick={onClose}>
        <div
          className="settings-modal settings-center"
          data-testid="settings-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="settings-modal-title"
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
              <div className="settings-modal-title" id="settings-modal-title">
                {sections.find((section) => section.id === activeSection)?.label}
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
                  onComposerMarkdownChange={setComposerMarkdown}
                  onUsePointerCursorsChange={setUsePointerCursors}
                  globalInstructionsDraft={globalInstructionsDraft}
                  onGlobalInstructionsDraftChange={setGlobalInstructionsDraft}
                  onSavePersonalization={handleSavePersonalization}
                  t={t}
                />
              )}

              {activeSection === 'workspace' && (
                <WorkspaceSettings
                  overview={runtime.overview}
                  loading={runtime.loading}
                  error={runtime.error}
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

              {activeSection === 'skills' && (
                <section className="settings-page settings-page-skills">
                  <RuntimeScopePanel overview={runtime.overview} scope={resourceScope} onScopeChange={setResourceScope} kinds={['skill']} onChanged={runtime.setOverview} />
                </section>
              )}

              {activeSection === 'agents' && (
                <section className="settings-page settings-page-agents">
                <RuntimeScopePanel overview={runtime.overview} scope={resourceScope} onScopeChange={setResourceScope} kinds={['agent']} showResourceStrip={false} onChanged={runtime.setOverview} />
                <AgentsSettings
                  settings={settings}
                  agentManifestDrafts={agentManifestDrafts}
                  onAgentManifestDraftsChange={setAgentManifestDrafts}
                  onRetrySaveAgentManifests={handleSaveAgentManifests}
                  onImportAgentManifest={handleImportAgentManifest}
                  agentManifestSaveState={agentManifestSaveState}
                  agentManifestSaveMessage={agentManifestSaveMessage}
                  t={t}
                /></section>
              )}

              {activeSection === 'tools' && (
                <section className="settings-page settings-page-tools">
                <RuntimeScopePanel overview={runtime.overview} scope={resourceScope} onScopeChange={setResourceScope} kinds={['mcp']} onChanged={runtime.setOverview} />
                <McpStatusDashboard />
                <ToolsSettings
                  rdxCliDraft={rdxCliDraft}
                  rdxActionsDraft={rdxActionsDraft}
                  onRdxCliDraftChange={setRdxCliDraft}
                  onRdxActionsDraftChange={setRdxActionsDraft}
                  onSaveToolsConfig={handleSaveToolsConfig}
                  t={t}
                /></section>
              )}

              {activeSection === 'hooks' && (
                <HooksSettings overview={runtime.overview} scope={resourceScope} onScopeChange={setResourceScope} onChanged={runtime.setOverview} />
              )}

              {activeSection === 'policy' && (
                <PolicySettings overview={runtime.overview} scope={resourceScope} onScopeChange={setResourceScope} onChanged={runtime.setOverview} />
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
          connectionAccountConnected={connectionAccountConnected}
          connectionDevicePending={connectionDevicePending}
          connectionNeedsCredentials={connectionNeedsCredentials}
          connectionNeedsBaseUrl={connectionNeedsBaseUrl}
          connectionHasFreshTest={connectionHasFreshTest}
          onClose={() => setConnectionDraft(null)}
          onUpdateConnectionDraft={updateConnectionDraft}
          onModelChange={updateConnectionModelPreference}
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
