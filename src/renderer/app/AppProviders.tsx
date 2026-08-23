import type { ReactNode } from 'react';
import { AppContextMenuHost } from './AppContextMenuHost';

/** Renderer-wide hosts. Language is a store-backed hook, not a React provider. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <AppContextMenuHost />
    </>
  );
}
