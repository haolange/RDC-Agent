import React from 'react';
import { OpenedCapturePreview } from '../OpenedCapturePreview';
import {
  formatBackendLabel,
  formatHumanPreviewLabel,
  formatOpenedAt,
  formatStatusLabel,
  getLeafName,
} from './sessionContextFormatters';
import type { SessionContextPanelViewModel } from './useSessionContextPanel';

interface SessionContextOpenedStateProps {
  vm: SessionContextPanelViewModel;
}

export const SessionContextOpenedState: React.FC<SessionContextOpenedStateProps> = ({ vm }) => {
  const {
    t,
    activeOpenedCapture,
    contextSnapshot,
    humanPreview,
    previewDisabledReason,
    canControlHumanPreview,
    isHumanPreviewOpen,
    handleOpenHumanPreview,
    handleCloseHumanPreview,
  } = vm;

  if (!activeOpenedCapture) {
    return null;
  }

  return (
    <div className="session-context-opened-state">
      <OpenedCapturePreview
        openedCapture={activeOpenedCapture}
        isLoading={activeOpenedCapture.status === 'opening'}
      />

      <div className="session-context-summary-card">
        <span className="session-context-label">{t('control.sessionContextOpenedCapture')}</span>
        <strong className="session-context-primary">{getLeafName(activeOpenedCapture.filePath)}</strong>
        <span className="session-context-secondary" title={activeOpenedCapture.filePath}>{activeOpenedCapture.filePath}</span>
      </div>

      <div className="session-context-facts">
        <div className="session-context-fact">
          <span className="session-context-label">{t('control.openedCaptureStatus')}</span>
          <span className={`session-context-value ${activeOpenedCapture.status === 'open' ? 'active' : ''}`}>
            {formatStatusLabel(activeOpenedCapture.status, t)}
          </span>
        </div>
        <div className="session-context-fact">
          <span className="session-context-label">{t('control.openedCaptureOpenedAt')}</span>
          <span className="session-context-value">{formatOpenedAt(activeOpenedCapture.openedAt)}</span>
        </div>
        <div className="session-context-fact">
          <span className="session-context-label">{t('control.sessionContextBackend')}</span>
          <span className="session-context-value">
            <span className={`context-badge ${contextSnapshot?.backend ?? activeOpenedCapture.backend}`}>
              {formatBackendLabel(contextSnapshot?.backend ?? activeOpenedCapture.backend, t)}
            </span>
          </span>
        </div>
        <div className="session-context-fact">
          <span className="session-context-label">{t('control.sessionContextDevice')}</span>
          <span className="session-context-value" title={contextSnapshot?.deviceLabel ?? activeOpenedCapture.deviceLabel}>
            {contextSnapshot?.deviceLabel ?? activeOpenedCapture.deviceLabel}
          </span>
        </div>
        <div className="session-context-fact">
          <span className="session-context-label">{t('control.sessionContextRuntimeOwner')}</span>
          <span className="session-context-value mono" title={contextSnapshot?.runtimeOwner ?? '--'}>
            {contextSnapshot?.runtimeOwner ?? '--'}
          </span>
        </div>
        <div className="session-context-fact">
          <span className="session-context-label">{t('control.sessionContextContextId')}</span>
          <span className="session-context-value mono" title={contextSnapshot?.contextId ?? activeOpenedCapture.contextId}>
            {(contextSnapshot?.contextId ?? activeOpenedCapture.contextId) || '--'}
          </span>
        </div>
        {(contextSnapshot?.sessionId ?? activeOpenedCapture.replaySessionId) && (
          <div className="session-context-fact">
            <span className="session-context-label">{t('control.sessionContextReplaySession')}</span>
            <span className="session-context-value mono" title={contextSnapshot?.sessionId ?? activeOpenedCapture.replaySessionId}>
              {contextSnapshot?.sessionId ?? activeOpenedCapture.replaySessionId}
            </span>
          </div>
        )}
        {contextSnapshot?.backend === 'remote' && (
          <div className="session-context-fact">
            <span className="session-context-label">{t('control.sessionContextRemoteStatus')}</span>
            <span className="session-context-value context-status">
              <span className={`context-status-dot ${contextSnapshot.remoteStatus === 'disconnected' ? 'offline' : contextSnapshot.remoteStatus ?? ''}`} />
              <span className="context-status-text">{contextSnapshot.remoteStatus ?? '--'}</span>
            </span>
          </div>
        )}
      </div>

      <div className="session-human-preview-card" data-testid="session-human-preview-status">
        <div className="session-human-preview-main">
          <span className={`session-human-preview-dot ${humanPreview?.status ?? 'closed'}`} />
          <span className="session-human-preview-copy">
            <span className="session-human-preview-title">{t('control.humanPreviewTitle')}</span>
            <span className="session-human-preview-detail">
              {formatHumanPreviewLabel(humanPreview?.status, t)}
              {humanPreview?.boundEventId ? ` · Event ${humanPreview.boundEventId}` : ''}
            </span>
            {humanPreview?.lastError || previewDisabledReason ? (
              <span className="session-human-preview-error">{humanPreview?.lastError ?? previewDisabledReason}</span>
            ) : null}
          </span>
        </div>
        <button
          type="button"
          className="panel-action-btn session-human-preview-button"
          data-testid={isHumanPreviewOpen ? 'session-context-close-human-preview' : 'session-context-open-human-preview'}
          onClick={() => void (isHumanPreviewOpen ? handleCloseHumanPreview() : handleOpenHumanPreview())}
          disabled={!canControlHumanPreview}
          title={previewDisabledReason || undefined}
        >
          <span>{isHumanPreviewOpen ? t('control.humanPreviewClose') : t('control.humanPreviewOpenAction')}</span>
        </button>
      </div>
    </div>
  );
};
