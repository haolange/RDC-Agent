import { AppContextMenuHost } from './AppContextMenuHost';
import type { ReactNode } from 'react';

/** Renderer-wide hosts. Language is a store-backed hook, not a React provider. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AppContextMenuHost />
    </>
  );
}
