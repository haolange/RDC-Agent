import React from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useI18n } from '../../i18n';
import { OpenedCapturePreview } from './OpenedCapturePreview';

const formatOpenedAt = (timestamp?: number): string => {
  if (!timestamp) return '--';
  return new Date(timestamp).toLocaleString();
};

const formatStatusLabel = (status?: string): string => {
  if (!status) return '--';
  if (status === 'open') return '已打开';
  if (status === 'opening') return '打开中';
  if (status === 'error') return '异常';
  return status;
};

export const OpenedCapture: React.FC = () => {
  const { t } = useI18n();
  const currentProject = useSessionStore((s) => s.currentProject);
  const currentRun = useSessionStore((s) => s.currentRun);
  const openedCapture = useSessionStore((s) => s.openedCapture);
  const setOpenedCapture = useSessionStore((s) => s.setOpenedCapture);
  const setContextSnapshot = useSessionStore((s) => s.setContextSnapshot);

  const activeOpenedCapture = currentProject && openedCapture?.projectId === currentProject.projectId
    ? openedCapture
    : null;

  const handleRefresh = () => {
    void window.electronAPI.capture.getOpenedState()
      .then((state) => setOpenedCapture(state))
      .catch(() => undefined);
    void window.electronAPI.context.get()
      .then((snapshot) => setContextSnapshot(snapshot))
      .catch(() => undefined);
  };

  const handleClear = () => {
    void window.electronAPI.capture.clearOpenedState()
      .then(() => {
        setOpenedCapture(null);
        setContextSnapshot(null);
      })
      .catch(() => undefined);
  };

  const fileName = activeOpenedCapture?.filePath.split(/[\\/]/).pop() ?? activeOpenedCapture?.filePath ?? '--';

  return (
    <div className="opened-capture" data-testid="opened-capture-panel">
      <OpenedCapturePreview
        openedCapture={activeOpenedCapture}
        isLoading={activeOpenedCapture?.status === 'opening'}
      />

      {activeOpenedCapture ? (
        <div className="opened-capture-summary">
          <div className="opened-capture-item">
            <span className="opened-capture-label">{t('control.openedCaptureFile')}</span>
            <span className="opened-capture-value" title={activeOpenedCapture.filePath}>{fileName}</span>
          </div>
          <div className="opened-capture-item">
            <span className="opened-capture-label">{t('control.openedCaptureSourceInput')}</span>
            <span className="opened-capture-value mono" title={activeOpenedCapture.inputId}>
              {activeOpenedCapture.inputId}
            </span>
          </div>
          <div className="opened-capture-item">
            <span className="opened-capture-label">{t('control.openedCaptureStatus')}</span>
            <span className={`opened-capture-value ${activeOpenedCapture.status === 'open' ? 'active' : ''}`}>
              {formatStatusLabel(activeOpenedCapture.status)}
            </span>
          </div>
          <div className="opened-capture-item">
            <span className="opened-capture-label">{t('control.openedCaptureOpenedAt')}</span>
            <span className="opened-capture-value">{formatOpenedAt(activeOpenedCapture.openedAt)}</span>
          </div>
        </div>
      ) : (
        <div className="opened-capture-empty">
          <div className="opened-capture-empty-title">{t('control.openedCaptureEmpty')}</div>
          <div className="opened-capture-empty-copy">{t('control.openedCaptureEmptyHint')}</div>
        </div>
      )}

      <div className="opened-capture-actions">
        <button
          type="button"
          className="panel-action-btn"
          data-testid="opened-capture-refresh"
          onClick={handleRefresh}
        >
          <span>{t('control.runtimeRefresh')}</span>
        </button>
        <button
          type="button"
          className="panel-action-btn"
          data-testid="opened-capture-clear"
          onClick={handleClear}
          disabled={!activeOpenedCapture || Boolean(currentRun)}
          title={currentRun ? t('control.captureSwitchLocked') : undefined}
        >
          <span>{t('control.openedCaptureClear')}</span>
        </button>
      </div>
    </div>
  );
};

export default OpenedCapture;
