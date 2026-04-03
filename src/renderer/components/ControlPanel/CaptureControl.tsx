import React, { useCallback } from 'react';
import { useSessionStore } from '../../stores/sessionStore';

const ROLE_LABELS: Record<string, string> = {
  primary: 'Primary',
  baseline: 'Baseline',
  reference: 'Reference',
  fix: 'Fix',
};

const BACKEND_LABELS: Record<string, string> = {
  local: 'Local',
  remote: 'Remote',
};

export const CaptureControl: React.FC = () => {
  const captures = useSessionStore((s) => s.captures);
  const contextSnapshot = useSessionStore((s) => s.contextSnapshot);

  const activeCapId = contextSnapshot?.activeCapture ?? null;

  const handleSelectCapture = useCallback(async (captureId: string) => {
    try {
      await window.electronAPI.capture.select(captureId);
    } catch (err) {
      console.error('Failed to select capture:', err);
    }
  }, []);

  return (
    <div className="capture-control">
      {/* Capture List */}
      <div className="capture-list">
        {captures.length === 0 ? (
          <div className="capture-empty">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            <span>No captures loaded</span>
          </div>
        ) : (
          captures.map((cap) => {
            const isActive = cap.id === activeCapId;
            const fileName = cap.filePath.split(/[\\/]/).pop() ?? cap.filePath;
            return (
              <div
                key={cap.id}
                className={`capture-item ${isActive ? 'active' : ''}`}
                onClick={() => void handleSelectCapture(cap.id)}
                style={{ cursor: 'pointer' }}
              >
                <div className="capture-item-icon">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </div>
                <div className="capture-item-info">
                  <div className="capture-item-name" title={fileName}>{fileName}</div>
                  <div className="capture-item-meta">
                    <span>{ROLE_LABELS[cap.role] ?? cap.role}</span>
                    <span className="capture-item-separator">·</span>
                    <span>{BACKEND_LABELS[cap.backendHint] ?? cap.backendHint}</span>
                    <span className="capture-item-separator">·</span>
                    <span className={`capture-status-badge ${cap.status}`}>{cap.status}</span>
                  </div>
                </div>
                {isActive && (
                  <div className="capture-item-active-indicator">
                    <span className="pulse-dot" />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Quick Stats */}
      {captures.length > 0 && (
        <div className="capture-stats">
          <div className="capture-stat">
            <span className="capture-stat-label">Total</span>
            <span className="capture-stat-value">{captures.length}</span>
          </div>
          <div className="capture-stat">
            <span className="capture-stat-label">Active</span>
            <span className="capture-stat-value active">
              {captures.filter((c) => c.id === activeCapId).length}
            </span>
          </div>
          <div className="capture-stat">
            <span className="capture-stat-label">Backend</span>
            <span className="capture-stat-value">
              {contextSnapshot?.backend ?? '--'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default CaptureControl;
