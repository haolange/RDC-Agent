import React from 'react';

export const AnalyzerPage: React.FC = () => {
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
        <div className="feature-placeholder-status">Coming Soon</div>
      </div>
    </div>
  );
};

export default AnalyzerPage;
