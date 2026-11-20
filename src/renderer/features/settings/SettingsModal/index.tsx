import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useModalFocus } from '../../../lib/useModalFocus';
import { isTopOverlayLayer, useOverlayLayer } from '../../../lib/overlayStack';
import { Icon } from '../../../ui/Icon';
import { ProductLogo } from '../../../ui/ProductLogo';
import { useAppSettingsStore } from '../../../stores/appSettingsStore';
import { IconButton } from '../../../ui/IconButton';
import { UnsavedChangesDialog } from '../../../ui/UnsavedChangesDialog';
import { useSettingsNavigationStore } from '../../../stores/settingsNavigationStore';
import { useSettingsModal } from './useSettingsModal';
import { ProviderDetail } from './sections/ProviderDetail';
import { SettingsCenterNav } from './SettingsCenterNav';
import { useRdcRuntimeOverview } from './useRdcRuntimeOverview';
import { useSettingsNavigation } from './useSettingsNavigation';
import { SettingsPageContent } from './SettingsPageContent';
import './SettingsModal.css';
import type { AppSettings } from '@shared/types/settings';

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, settings, onClose }) => {
  const modal = useSettingsModal(open, settings);
  const systemTheme = useAppSettingsStore((state) => state.systemTheme);
  const theme = settings.appearance.theme === 'system' ? systemTheme : settings.appearance.theme;
  const dialogRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const runtime = useRdcRuntimeOverview(open);
  const [resourceScope, setResourceScope] = useState<'user' | 'project'>('user');
  const agentRequest = useSettingsNavigationStore((state) => state.agentRequest);
  const sectionRequest = useSettingsNavigationStore((state) => state.sectionRequest);
  const clearSectionRequest = useSettingsNavigationStore((state) => state.clearSectionRequest);
  const clearAgentRequest = useSettingsNavigationStore((state) => state.clearAgentRequest);
  const {
    t,
    activeSection,
    setActiveSection,
    sections,
    connectionDraft,
    setConnectionDraft,
    getResolvedProviderLabel,
    connectionProvider,
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
    handleRefreshProviderModels,
    handleDisconnectProvider,
  } = modal;

  const { pendingLeave, keepEditing, discardAndLeave, guardLeave, requestClose, setResourceDraftDirty } =
    useSettingsNavigation(modal, settings, onClose);

  const closeSurface = useCallback(() => {
    if (connectionDraft) {
      setConnectionDraft(null);
      return;
    }
    requestClose();
  }, [connectionDraft, requestClose, setConnectionDraft]);
  const { layerId } = useOverlayLayer(open);
  useModalFocus({
    open,
    containerRef: dialogRef,
    onClose: closeSurface,
    trap: true,
    layerId,
  });

  // The selected provider's detail sits beside the provider list on the model services page.
  const providerDetail = connectionDraft && connectionProvider ? (
    <ProviderDetail
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
      onRefreshModels={handleRefreshProviderModels}
      onDisconnect={handleDisconnectProvider}
      t={t}
    />
  ) : null;

  useEffect(() => {
    if (!open) return;
    panelRef.current?.scrollTo({ top: 0, left: 0 });
  }, [activeSection, open]);

  useEffect(() => {
    if (open && agentRequest) setActiveSection('agents');
  }, [open, agentRequest, setActiveSection]);
  useEffect(() => {
    if (!open || !sectionRequest) return;
    setActiveSection(sectionRequest.section);
    clearSectionRequest(sectionRequest.sequence);
  }, [open, sectionRequest, setActiveSection, clearSectionRequest]);

  if (!open) return null;

  const activeSectionMeta = sections.find((section) => section.id === activeSection);

  return createPortal(
    <>
      <div className="settings-modal-backdrop" onMouseDown={(event) => {
        if (event.target === event.currentTarget && isTopOverlayLayer(layerId)) requestClose();
      }}>
        <div
          ref={dialogRef}
          className="settings-modal settings-center"
          data-testid="settings-modal"
          role="dialog"
          tabIndex={-1}
          aria-modal="true"
          aria-labelledby="settings-modal-title"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="settings-center-sidebar">
            <div className="settings-center-brand">
              <ProductLogo accent={settings.appearance.chromeThemes[theme].accent} />
              <div className="settings-center-brand-copy">
                <div className="settings-center-brand-title">RDC-Agent</div>
                <div className="settings-center-brand-subtitle">{t('settings.title')}</div>
              </div>
            </div>

            <SettingsCenterNav
              sections={sections}
              activeSection={activeSection}
              onSelectSection={(section) => guardLeave(() => {
                if (section !== 'agents') clearAgentRequest();
                setActiveSection(section);
              })}
              providers={[...modal.accountProviders, ...modal.providerCatalog].map((provider) => ({
                id: provider.id,
                label: modal.getResolvedProviderLabel(provider),
                open: () => guardLeave(() => { setActiveSection('models'); modal.openProviderConnection(provider); }),
              }))}
              t={t}
            />

          </div>

          <div className="settings-center-content">
            <div className="settings-modal-header">
              <div className="settings-modal-heading">
                <div className="settings-modal-title" id="settings-modal-title">
                  {activeSectionMeta?.label}
                </div>
                {activeSectionMeta?.subtitle ? (
                  <p className="settings-modal-subtitle">{activeSectionMeta.subtitle}</p>
                ) : null}
              </div>
              <IconButton
                className="settings-modal-close"
                label={t('settings.close')}
                onClick={requestClose}
              >
                <Icon name="close" size={16} />
              </IconButton>
            </div>

            <div ref={panelRef} className="settings-center-panel scrollbar-thin" data-testid="settings-center-panel">
              <SettingsPageContent modal={modal} settings={settings} runtime={runtime}
                resourceScope={resourceScope} setResourceScope={setResourceScope}
                setResourceDraftDirty={setResourceDraftDirty}
                selectedProviderId={connectionProvider?.id ?? null} providerDetail={providerDetail} />
            </div>
          </div>
        </div>
      </div>

      {pendingLeave ? (
        <UnsavedChangesDialog
          title={t('settings.unsavedExitTitle')}
          message={t('settings.unsavedExitMessage')}
          keepEditingLabel={t('settings.keepEditing')}
          discardLabel={t('settings.discardChanges')}
          onKeepEditing={keepEditing}
          onDiscard={discardAndLeave}
        />
      ) : null}

    </>,
    document.body,
  );
};

export default SettingsModal;
