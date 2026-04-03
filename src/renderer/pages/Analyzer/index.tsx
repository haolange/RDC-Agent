import React from 'react';
import { MODE_CAPABILITIES } from '@shared/constants/modes';
import { useSessionStore } from '../../stores/sessionStore';

export const AnalyzerPage: React.FC = () => {
  const currentRun = useSessionStore((s) => s.currentRun);
  const caps = MODE_CAPABILITIES['analyzer'];

  return (
    <div className="feature-placeholder">
      <div className="feature-placeholder-card">
        <div className="feature-placeholder-icon">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <h1 className="feature-placeholder-title">Analyzer</h1>
        <p className="feature-placeholder-description">
          Pipeline reconstruction, capture correlation, and bottleneck surfacing will land here next.
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

export default AnalyzerPage;
