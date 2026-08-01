import { ipcRenderer } from 'electron';
import type {
  RendererApiTransport,
  RendererEventCallback,
  RendererEventChannel,
  RendererInvokeChannel,
} from '@shared/renderer-api';

export function createIpcRendererTransport(): RendererApiTransport {
  const listenerMap = new Map<RendererEventChannel, Map<RendererEventCallback, RendererEventCallback>>();

  const removeListener = (channel: RendererEventChannel, callback: RendererEventCallback): void => {
    const channelListeners = listenerMap.get(channel);
    const wrappedCallback = channelListeners?.get(callback);
    if (!wrappedCallback) return;
    ipcRenderer.removeListener(channel, wrappedCallback as Parameters<typeof ipcRenderer.removeListener>[1]);
    channelListeners?.delete(callback);
    if (channelListeners?.size === 0) listenerMap.delete(channel);
  };

  const addListener = (channel: RendererEventChannel, callback: RendererEventCallback): void => {
    const wrappedCallback: RendererEventCallback = (_event: unknown, ...args: unknown[]) => callback(...args);
    const channelListeners = listenerMap.get(channel) ?? new Map<RendererEventCallback, RendererEventCallback>();
    channelListeners.set(callback, wrappedCallback);
    listenerMap.set(channel, channelListeners);
    ipcRenderer.on(channel, wrappedCallback);
  };

  return {
    invoke: <TResult>(channel: RendererInvokeChannel, ...args: unknown[]): Promise<TResult> => (
      ipcRenderer.invoke(channel, ...args) as Promise<TResult>
    ),
    subscribe: (channel, callback) => {
      addListener(channel, callback);
      return () => removeListener(channel, callback);
    },
    addListener,
    removeListener,
    removeAllListeners: (channel) => {
      listenerMap.delete(channel);
      ipcRenderer.removeAllListeners(channel);
    },
  };
}
