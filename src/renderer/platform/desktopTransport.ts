import type { RendererEventCallback, RendererApiTransport, DesktopIpc } from '@shared/renderer-api/transport';
import type { RendererEventChannel } from '@shared/renderer-api/channels';

/**
 * The desktop transport over the preload's `rdcIpc`. Listener identity is kept here, in the renderer's realm, so
 * `off(channel, callback)` removes exactly the subscription `on(channel, callback)` made.
 */
export function createDesktopTransport(ipc: DesktopIpc): RendererApiTransport {
  const subscriptions = new Map<RendererEventChannel, Map<RendererEventCallback, () => void>>();

  const removeListener = (channel: RendererEventChannel, callback: RendererEventCallback): void => {
    const channelSubscriptions = subscriptions.get(channel);
    channelSubscriptions?.get(callback)?.();
    channelSubscriptions?.delete(callback);
    if (channelSubscriptions?.size === 0) subscriptions.delete(channel);
  };

  return {
    invoke: <TResult>(channel: Parameters<DesktopIpc['invoke']>[0], ...args: unknown[]) => ipc.invoke(channel, ...args) as Promise<TResult>,
    subscribe: (channel, callback) => ipc.subscribe(channel, callback),
    addListener: (channel, callback) => {
      removeListener(channel, callback);
      const channelSubscriptions = subscriptions.get(channel) ?? new Map<RendererEventCallback, () => void>();
      channelSubscriptions.set(callback, ipc.subscribe(channel, callback));
      subscriptions.set(channel, channelSubscriptions);
    },
    removeListener,
    removeAllListeners: (channel) => {
      for (const unsubscribe of subscriptions.get(channel)?.values() ?? []) unsubscribe();
      subscriptions.delete(channel);
    },
  };
}
