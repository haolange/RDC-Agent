import { acceptsEventPayload, type RendererEventPayload } from './eventPayloads';
import type { RendererEventChannel } from './channels';
import type { RendererApiTransport, RendererEventCallback } from './transport';

export type RendererEventListener<Channel extends RendererEventChannel> = (
  payload: RendererEventPayload<Channel>,
) => void;

/** Subscriptions to main's pushed events in which every payload is checked against its channel before a listener runs. */
export interface RendererEvents {
  subscribe<Channel extends RendererEventChannel>(
    channel: Channel,
    listener: RendererEventListener<Channel>,
  ): () => void;
  /** Adds a listener that `remove` with the same function takes off again; adding it twice keeps one. */
  add<Channel extends RendererEventChannel>(channel: Channel, listener: RendererEventListener<Channel>): void;
  remove<Channel extends RendererEventChannel>(channel: Channel, listener: RendererEventListener<Channel>): void;
  removeAll(channel: RendererEventChannel): void;
}

export function createRendererEvents(transport: RendererApiTransport): RendererEvents {
  const added = new Map<RendererEventChannel, Map<object, RendererEventCallback>>();
  const validating =
    <Channel extends RendererEventChannel>(
      channel: Channel,
      listener: RendererEventListener<Channel>,
    ): RendererEventCallback =>
    (payload: unknown) => {
      if (acceptsEventPayload(channel, payload)) listener(payload);
    };
  const remove = (channel: RendererEventChannel, listener: object): void => {
    const channelListeners = added.get(channel);
    const wrapper = channelListeners?.get(listener);
    if (!channelListeners || !wrapper) return;
    transport.removeListener(channel, wrapper);
    channelListeners.delete(listener);
  };
  return {
    subscribe: (channel, listener) => transport.subscribe(channel, validating(channel, listener)),
    add: (channel, listener) => {
      remove(channel, listener);
      const wrapper = validating(channel, listener);
      const channelListeners = added.get(channel) ?? new Map<object, RendererEventCallback>();
      channelListeners.set(listener, wrapper);
      added.set(channel, channelListeners);
      transport.addListener(channel, wrapper);
    },
    remove,
    removeAll: (channel) => {
      added.delete(channel);
      transport.removeAllListeners(channel);
    },
  };
}
