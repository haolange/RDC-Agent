import React from 'react';
import { MODE_CAPABILITIES } from '@shared/constants/modes';
import { useSessionStore } from '../../stores/sessionStore';

export const OptimizerPage: React.FC = () => {
  const currentRun = useSessionStore((s) => s.currentRun);
  const caps = MODE_CAPABILITIES['optimizer'];

  return (
    <div className="feature-placeholder">
      <div className="feature-placeholder-card">
        <div className="feature-placeholder-icon">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        </div>
        <h1 className="feature-placeholder-title">Optimizer</h1>
        <p className="feature-placeholder-description">
          Performance diagnosis, render cost ranking, and action-ready tuning guidance will be introduced here.
        </p>

        {/* Session overview if active */}
        {currentRun && (
          <div className="feature-placeholder-session">
            <div className="context-item">
              <span className="context-item-label">Active Run</span>
              <span className="context-item-value mono">{currentRun.runId.slice(0, 12)}</span>
            </div>
            <div className="context-item">
              <span className="context-item-label">Goal</span>
              <span className="context-item-value">{currentRun.goal}</span>
            </div>
          </div>
        )}

        {/* Mode capabilities */}
        <div className="feature-placeholder-caps">
          <div className="feature-placeholder-caps-title">Available Stages ({caps.availableStages.length})</div>
          <div className="feature-placeholder-caps-list">
            {caps.availableStages.map((stage) => (
              <span key={stage} className="feature-placeholder-cap-badge">{stage}</span>
            ))}
          </div>
        </div>

        {caps.disabledReason && (
          <div className="feature-placeholder-reason">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {caps.disabledReason}
          </div>
        )}

        <div className="feature-placeholder-status">Coming Soon</div>
      </div>
    </div>
  );
};

export default OptimizerPage;
