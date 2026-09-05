import type { ReactNode } from 'react';
import './ResourceEmptyState.css';

/** Shared empty resource treatment for Knowledge and Settings. */
export function ResourceEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="resource-empty-state">
      <svg className="resource-empty-state-icon" width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <rect x="8" y="8" width="26" height="32" rx="5" />
        <path d="M16 18h10M16 24h14M16 30h7M38 15v20a9 9 0 0 1-9 9" strokeLinecap="round" />
      </svg>
      <span>{children}</span>
    </div>
  );
}
