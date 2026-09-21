import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { AppSettings } from '@shared/types/settings';
import { useModalFocus } from '../../../lib/useModalFocus';
import { useOverlayLayer } from '../../../lib/overlayStack';
import { useSettingsModal } from './useSettingsModal';
import { ProviderConnectDialog } from './sections/ProviderConnectDialog';
import { SettingsCenterNav } from './SettingsCenterNav';
import { useRdcRuntimeOverview } from './useRdcRuntimeOverview';
import { Icon } from '../../../ui/Icon';
import { IconButton } from '../../../ui/IconButton';
import { UnsavedChangesDialog } from '../../../ui/UnsavedChangesDialog';
import { useSettingsNavigation } from './useSettingsNavigation';
import { SettingsPageContent } from './SettingsPageContent';
import './SettingsModal.css';

interface SettingsModalProps {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ open, settings, onClose }) => {
  const modal = useSettingsModal(open, settings);
  const dialogRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const runtime = useRdcRuntimeOverview(open);
  const [resourceScope, setResourceScope] = useState<'user' | 'project'>('user');
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
    trap: !connectionDraft,
    layerId,
  });

  useEffect(() => {
    if (!open) return;
    panelRef.current?.scrollTo({ top: 0, left: 0 });
  }, [activeSection, open]);

  if (!open) return null;

  const activeSectionMeta = sections.find((section) => section.id === activeSection);

  return createPortal(
    <>
      <div className="settings-modal-backdrop" onClick={requestClose}>
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
              <div className="settings-center-brand-icon">RD</div>
              <div className="settings-center-brand-copy">
                <div className="settings-center-brand-title">RDC-Agent</div>
                <div className="settings-center-brand-subtitle">{t('settings.title')}</div>
              </div>
            </div>

            <SettingsCenterNav
              sections={sections}
              activeSection={activeSection}
              onSelectSection={(section) => guardLeave(() => setActiveSection(section))}
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
                setResourceDraftDirty={setResourceDraftDirty} />
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
