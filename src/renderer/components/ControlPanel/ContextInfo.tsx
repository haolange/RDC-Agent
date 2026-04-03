import React from 'react';
import { useSessionStore } from '../../stores/sessionStore';

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

export const ContextInfo: React.FC = () => {
  const contextSnapshot = useSessionStore((s) => s.contextSnapshot);
  const currentRun = useSessionStore((s) => s.currentRun);
  const openedCapture = useSessionStore((s) => s.openedCapture);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => undefined);
  };

  if (!contextSnapshot && !currentRun && !openedCapture) {
    return (
      <div className="context-info">
        <div className="context-empty" style={{ padding: '12px 0', textAlign: 'center', fontSize: 'var(--text-xs)', color: 'rgb(var(--color-text-3))' }}>
          No active session
        </div>
      </div>
    );
  }

  return (
    <div className="context-info">
      {openedCapture && (
        <div className="context-section">
          <div className="context-section-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            <span>Opened Capture</span>
          </div>
          <div className="context-section-content">
            <div className="context-item">
              <span className="context-item-label">Input ID</span>
              <span className="context-item-value mono" title={openedCapture.inputId}>
                {openedCapture.inputId ? `${openedCapture.inputId.slice(0, 12)}…` : '--'}
              </span>
            </div>
            <div className="context-item">
              <span className="context-item-label">Capture</span>
              <span className="context-item-value mono" title={openedCapture.filePath}>
                {openedCapture.filePath.split(/[\\/]/).pop() ?? openedCapture.filePath}
              </span>
            </div>
            <div className="context-item">
              <span className="context-item-label">Device</span>
              <span className="context-item-value">{openedCapture.deviceLabel}</span>
            </div>
            <div className="context-item">
              <span className="context-item-label">Backend</span>
              <span className="context-item-value">
                <span className={`context-badge ${openedCapture.backend}`}>{openedCapture.backend}</span>
              </span>
            </div>
            <div className="context-item">
              <span className="context-item-label">Status</span>
              <span className={`context-item-value ${openedCapture.status === 'open' ? 'active' : ''}`}>
                {openedCapture.status}
              </span>
            </div>
          </div>
        </div>
      )}

      {currentRun && (
        <div className="context-section">
          <div className="context-section-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" />
              <line x1="3" y1="10" x2="21" y2="10" />
            </svg>
            <span>Session</span>
          </div>
          <div className="context-section-content">
            <div className="context-item">
              <span className="context-item-label">Session ID</span>
              <span className="context-item-value mono" title={currentRun.sessionId}>
                {currentRun.sessionId ? `${currentRun.sessionId.slice(0, 8)}…` : '--'}
              </span>
            </div>
            <div className="context-item">
              <span className="context-item-label">Case ID</span>
              <span className="context-item-value mono" title={currentRun.caseId}>
                {currentRun.caseId ? `${currentRun.caseId.slice(0, 8)}…` : '--'}
              </span>
            </div>
            <div className="context-item">
              <span className="context-item-label">Mode</span>
              <span className="context-item-value">
                <span className={`context-badge ${currentRun.mode}`}>{currentRun.mode}</span>
              </span>
            </div>
            <div className="context-item">
              <span className="context-item-label">Status</span>
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
            <span>Replay Context</span>
          </div>
          <div className="context-section-content">
            <div className="context-item">
              <span className="context-item-label">Context ID</span>
              <span className="context-item-value mono" title={contextSnapshot.contextId}>
                {contextSnapshot.contextId ? `${contextSnapshot.contextId.slice(0, 8)}…` : '--'}
              </span>
            </div>
            <div className="context-item">
              <span className="context-item-label">Backend</span>
              <span className="context-item-value">
                <span className={`context-badge ${contextSnapshot.backend}`}>{contextSnapshot.backend}</span>
              </span>
            </div>
            {contextSnapshot.backend === 'remote' && (
              <div className="context-item">
                <span className="context-item-label">Remote</span>
                <span className="context-item-value context-status">
                  {getRemoteStatusIcon(contextSnapshot.remoteStatus)}
                  <span className="context-status-text">{contextSnapshot.remoteStatus ?? 'unknown'}</span>
                </span>
              </div>
            )}
            <div className="context-item">
              <span className="context-item-label">Owner</span>
              <span className="context-item-value mono" title={contextSnapshot.runtimeOwner}>
                {contextSnapshot.runtimeOwner ? `${contextSnapshot.runtimeOwner.slice(0, 12)}…` : '--'}
              </span>
            </div>
            <div className="context-item">
              <span className="context-item-label">Device</span>
              <span className="context-item-value">{contextSnapshot.deviceLabel || '--'}</span>
            </div>
          </div>
        </div>
      )}

      <div className="context-actions">
        <button
          className="context-action-btn"
          onClick={() => {
            window.electronAPI?.context.get()
              .then((snapshot) => useSessionStore.getState().setContextSnapshot(snapshot))
              .catch(() => undefined);
            window.electronAPI?.capture.getOpenedState()
              .then((state) => useSessionStore.getState().setOpenedCapture(state))
              .catch(() => undefined);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          <span>Refresh</span>
        </button>
        <button
          className="context-action-btn"
          onClick={() => {
            window.electronAPI.capture.clearOpenedState()
              .then(() => useSessionStore.getState().setOpenedCapture(null))
              .catch(() => undefined);
          }}
          disabled={!openedCapture}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          <span>Clear Open</span>
        </button>
        <button
          className="context-action-btn"
          onClick={() => {
            const id = openedCapture?.contextId || contextSnapshot?.contextId || currentRun?.sessionId;
            if (id) copyToClipboard(id);
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          <span>Copy ID</span>
        </button>
      </div>
    </div>
  );
};

export default ContextInfo;
