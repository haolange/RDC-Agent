import type { RendererEventChannel, RendererInvokeChannel } from './channels';

export type RendererEventCallback = (...args: unknown[]) => void;

export interface RendererApiTransport {
  invoke<TResult>(channel: RendererInvokeChannel, ...args: unknown[]): Promise<TResult>;
  subscribe(channel: RendererEventChannel, callback: RendererEventCallback): () => void;
  addListener(channel: RendererEventChannel, callback: RendererEventCallback): void;
  removeListener(channel: RendererEventChannel, callback: RendererEventCallback): void;
  removeAllListeners(channel: RendererEventChannel): void;
}
