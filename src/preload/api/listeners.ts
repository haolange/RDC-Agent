import { ipcRenderer } from 'electron';

const listenerMap = new Map<string, Map<(...args: unknown[]) => void, (...args: unknown[]) => void>>();

export const registerTrackedListener = (channel: string, callback: (...args: unknown[]) => void): (() => void) => {
  const wrappedCallback = (_event: unknown, ...args: unknown[]) => callback(...args);
  const channelListeners = listenerMap.get(channel) ?? new Map();
  channelListeners.set(callback, wrappedCallback);
  listenerMap.set(channel, channelListeners);
  ipcRenderer.on(channel, wrappedCallback);
  return () => removeTrackedListener(channel, callback);
};

export const removeTrackedListener = (channel: string, callback: (...args: unknown[]) => void): void => {
  const wrappedCallback = listenerMap.get(channel)?.get(callback);
  if (wrappedCallback) {
    ipcRenderer.removeListener(channel, wrappedCallback as Parameters<typeof ipcRenderer.removeListener>[1]);
    listenerMap.get(channel)?.delete(callback);
  }
};

export const removeAllTrackedListeners = (channel: string): void => {
  ipcRenderer.removeAllListeners(channel);
};
