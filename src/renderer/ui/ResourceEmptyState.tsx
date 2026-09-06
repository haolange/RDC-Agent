import type { ReactNode } from 'react';
import { EmptyState } from './EmptyState';

/** Alias for Knowledge and Settings empty lists. Prefer `EmptyState` for new UI. */
export function ResourceEmptyState({ children }: { children: ReactNode }) {
  return (
    <EmptyState
      className="resource-empty-state"
      title={(
        <>
          <span className="resource-empty-state-icon" aria-hidden="true" />
          {children}
        </>
      )}
    />
  );
}
