import type { ReactNode } from 'react';

/** Aggregates renderer-wide providers; i18n is mounted at main.tsx today. */
export function AppProviders({ children }: { children: ReactNode }) {
  return children;
}
