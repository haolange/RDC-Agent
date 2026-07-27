import React from 'react';
import type { ProgressTaskStatus } from '@shared/types/trace';

const CheckIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.25 8.25 3 3 6.5-7" /></svg>
);

const CancelIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" /></svg>
);

const BlockedIcon: React.FC = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.25v5m0 3.5h.01" /></svg>
);

export const TraceProgressMarker: React.FC<{ status: ProgressTaskStatus; index: number }> = ({ status, index }) => {
  if (status === 'completed') return <span className="trace-progress-marker is-completed" aria-label="completed"><CheckIcon /></span>;
  if (status === 'cancelled') return <span className="trace-progress-marker is-cancelled" aria-label="cancelled"><CancelIcon /></span>;
  if (status === 'blocked') return <span className="trace-progress-marker is-blocked" aria-label="blocked"><BlockedIcon /></span>;
  return <span className={`trace-progress-marker ${status === 'running' ? 'is-running' : 'is-pending'}`} aria-label={status}>{index}</span>;
};