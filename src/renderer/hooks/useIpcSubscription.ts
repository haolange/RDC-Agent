import { useEffect } from 'react';

/**
 * Subscribes to a window.electronAPI IPC channel for the lifetime of the component.
 * No-ops when electronAPI is unavailable (e.g. Browser Preview without fallback).
 */
export const useIpcSubscription = (
  channel: string | null | undefined,
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
