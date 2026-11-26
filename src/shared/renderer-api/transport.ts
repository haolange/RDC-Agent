import type { RendererEventChannel, RendererInvokeChannel } from './channels';

export type RendererEventCallback = (...args: unknown[]) => void;

/** What `createRendererApi` builds on: the desktop IPC bridge or the Browser QA bridge client. */
export interface RendererApiTransport {
  /** Resolves with the handler's value or with an `IpcErrorResult`; `createRendererApi` turns the latter into a throw. */
  invoke<TResult>(channel: RendererInvokeChannel, ...args: unknown[]): Promise<TResult>;
  subscribe(channel: RendererEventChannel, callback: RendererEventCallback): () => void;
  addListener(channel: RendererEventChannel, callback: RendererEventCallback): void;
  removeListener(channel: RendererEventChannel, callback: RendererEventCallback): void;
  removeAllListeners(channel: RendererEventChannel): void;
}

/**
 * The only object the desktop preload exposes (`window.rdcIpc`): declared channels only, plain data only. The renderer
 * builds the typed API on it, so failures become `RendererIpcError` in the renderer's own realm — an error thrown in
 * the preload would reach the page with its code and params stripped by the context bridge.
 */
export interface DesktopIpc {
  platform: NodeJS.Platform;
  invoke(channel: RendererInvokeChannel, ...args: unknown[]): Promise<unknown>;
  subscribe(channel: RendererEventChannel, callback: RendererEventCallback): () => void;
}
