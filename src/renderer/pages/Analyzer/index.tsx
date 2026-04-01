import React from 'react';

/**
 * Analyzer Page - 分析页面（占位）
 */
export const AnalyzerPage: React.FC = () => {
  return (
    <div className="placeholder-page">
      <div className="placeholder-content">
        <div className="placeholder-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <h1>Analyzer</h1>
        <p>Capture analysis and pipeline reconstruction</p>
        <p className="placeholder-status">Coming Soon</p>
      </div>
    </div>
  );
};

export default AnalyzerPage;
