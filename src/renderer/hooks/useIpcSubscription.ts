import { useEffect } from 'react';
import type { RendererEventChannel } from '@shared/renderer-api/channels';

/**
 * Subscribes to a window.electronAPI IPC channel for the lifetime of the component.
 * No-ops when electronAPI is unavailable.
 */
export const useIpcSubscription = (
  channel: RendererEventChannel | null | undefined,
  handler: (...args: unknown[]) => void,
): void => {
  useEffect(() => {
    if (!channel) {
      return undefined;
    }

    const electronAPI = window.electronAPI;
    if (!electronAPI) {
      return undefined;
    }

    electronAPI.on(channel, handler);
    return () => {
      electronAPI.off(channel, handler);
    };
  }, [channel, handler]);
};
