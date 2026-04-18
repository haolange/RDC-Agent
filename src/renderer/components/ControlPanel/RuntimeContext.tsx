import React from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useI18n } from '../../i18n';

const getRemoteStatusIcon = (status?: string) => {
  switch (status) {
    case 'online':
      return <span className="context-status-dot online" />;
    case 'connected':
      return <span className="context-status-dot connected" />;
    case 'disconnected':
      return <span className="context-status-dot offline" />;
    case 'error':
      return <span className="context-status-dot error" />;
    default:
      return <span className="context-status-dot" />;
  }
};

const formatBackendLabel = (backend?: string): string => {
  if (backend === 'local') return '本地';
  if (backend === 'remote') return '远端';
  return backend || '--';
};

export const RuntimeContext: React.FC = () => {
  const { t } = useI18n();
  const contextSnapshot = useSessionStore((s) => s.contextSnapshot);
  const currentRun = useSessionStore((s) => s.currentRun);
  const setContextSnapshot = useSessionStore((s) => s.setContextSnapshot);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => undefined);
  };

  if (!contextSnapshot && !currentRun) {
    return (
      <div className="runtime-context">
        <div className="context-empty">
          {t('control.runtimeContextEmpty')}
        </div>
      </div>
    );
  }

  return (
    <div className="runtime-context" data-testid="runtime-context-panel">
      {currentRun && (
        <div className="context-section">
          <div className="context-section-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>当前会话</span>
          </div>
          <div className="context-section-content">
            <div className="context-item">
              <span className="context-item-label">会话 ID</span>
              <span className="context-item-value mono" title={currentRun.sessionId}>
                {currentRun.sessionId || '--'}
              </span>
            </div>
            <div className="context-item">
              <span className="context-item-label">Case ID</span>
              <span className="context-item-value mono" title={currentRun.caseId}>
                {currentRun.caseId || '--'}
              </span>
            </div>
            <div className="context-item">
              <span className="context-item-label">模式</span>
              <span className="context-item-value">
                <span className={`context-badge ${currentRun.mode}`}>{currentRun.mode}</span>
              </span>
            </div>
            <div className="context-item">
              <span className="context-item-label">运行状态</span>
              <span className={`context-item-value ${currentRun.status === 'running' ? 'active' : ''}`}>
                {currentRun.status}
              </span>
            </div>
          </div>
        </div>
      )}

      {contextSnapshot && (
        <div className="context-section">
          <div className="context-section-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>回放上下文</span>
          </div>
          <div className="context-section-content">
            <div className="context-item">
              <span className="context-item-label">Context ID</span>
              <span className="context-item-value mono" title={contextSnapshot.contextId}>
                {contextSnapshot.contextId || '--'}
              </span>
            </div>
            <div className="context-item">
              <span className="context-item-label">Replay Session</span>
              <span className="context-item-value mono" title={contextSnapshot.sessionId}>
                {contextSnapshot.sessionId || '--'}
              </span>
            </div>
            <div className="context-item">
              <span className="context-item-label">回放后端</span>
              <span className="context-item-value">
                <span className={`context-badge ${contextSnapshot.backend}`}>{formatBackendLabel(contextSnapshot.backend)}</span>
              </span>
            </div>
            {contextSnapshot.backend === 'remote' && (
              <div className="context-item">
                <span className="context-item-label">远端状态</span>
                <span className="context-item-value context-status">
                  {getRemoteStatusIcon(contextSnapshot.remoteStatus)}
                  <span className="context-status-text">{contextSnapshot.remoteStatus ?? 'unknown'}</span>
                </span>
              </div>
            )}
            <div className="context-item">
              <span className="context-item-label">Runtime Owner</span>
              <span className="context-item-value mono" title={contextSnapshot.runtimeOwner}>
                {contextSnapshot.runtimeOwner || '--'}
              </span>
            </div>
            <div className="context-item">
              <span className="context-item-label">Owner Lease</span>
              <span className="context-item-value mono" title={contextSnapshot.ownerLeaseId}>
                {contextSnapshot.ownerLeaseId || '--'}
              </span>
            </div>
            <div className="context-item">
              <span className="context-item-label">回放设备</span>
              <span className="context-item-value">{contextSnapshot.deviceLabel || '--'}</span>
            </div>
          </div>
        </div>
      )}

      <div className="runtime-context-actions">
        <button
          type="button"
          className="panel-action-btn"
          data-testid="runtime-context-refresh"
          onClick={() => {
            window.electronAPI?.context.get()
              .then((snapshot) => setContextSnapshot(snapshot))
              .catch(() => undefined);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          <span>{t('control.runtimeRefresh')}</span>
        </button>
        <button
          type="button"
          className="panel-action-btn"
          data-testid="runtime-context-copy-id"
          onClick={() => {
            const id = contextSnapshot?.contextId;
            if (id) copyToClipboard(id);
          }}
          disabled={!contextSnapshot?.contextId}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span>{t('control.copyContextId')}</span>
        </button>
      </div>
    </div>
  );
};

export default RuntimeContext;
