import { useClipboardBridge } from '../hooks/useClipboardBridge';
import { ClipboardContext } from '../lib/clipboard';
import { ProximityHost } from '../ui/ProximityHost';
import { TooltipHost } from '../ui/TooltipHost';
import { AppContextMenuHost } from './AppContextMenuHost';
import type { ReactNode } from 'react';

/** Renderer-wide hosts. Language is a store-backed hook, not a React provider. */
export function AppProviders({ children }: { children: ReactNode }) {
  const { copyText } = useClipboardBridge();
  return (
    <ClipboardContext.Provider value={copyText}>
      {children}
      <AppContextMenuHost />
      <TooltipHost />
      <ProximityHost />
    </ClipboardContext.Provider>
  );
}
