import React from 'react';
import type { ProgressTaskStatus } from '@shared/types/trace';

export const TraceProgressMarker: React.FC<{ status: ProgressTaskStatus; index: number }> = ({ status, index }) => {
  if (status === 'completed') {
    return (
      <span className="trace-progress-marker is-completed" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="11" height="11">
          <path d="M3.5 8.4 L6.6 11.4 L12.6 4.6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (status === 'blocked') {
    return (
      <span className="trace-progress-marker is-blocked" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="12" height="12">
          <path d="M8 2 L14.5 13 L1.5 13 Z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          <line x1="8" y1="6.4" x2="8" y2="9.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          <circle cx="8" cy="11.1" r="0.7" fill="currentColor" />
        </svg>
      </span>
    );
  }
  return (
    <span className={`trace-progress-marker ${status === 'running' ? 'is-running' : 'is-pending'}`} aria-hidden="true">
      <span className="trace-progress-index">{index}</span>
    </span>
  );
};
