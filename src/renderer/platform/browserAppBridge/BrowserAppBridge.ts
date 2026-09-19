import type { ElectronAPI } from '@shared/types/electron';
import {
  createRendererApi,
  type RendererApiTransport,
  type RendererEventCallback,
  type RendererEventChannel,
  type RendererInvokeChannel,
} from '@shared/renderer-api';
import { connectBrowserEventStream } from './browserEventStream';

const BRIDGE_MARKER = '__RDC_AGENT_BROWSER_APP_BRIDGE__';

type BrowserBridgeWindow = Window & {
  [BRIDGE_MARKER]?: true;
};

function detectPlatform(): NodeJS.Platform {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) return 'win32';
  if (platform.includes('mac')) return 'darwin';
  if (platform.includes('linux')) return 'linux';
  return 'browser' as NodeJS.Platform;
}

/**
 * Same-origin Browser QA client. Bridge origin is always window.location.origin
 * (Vite is reverse-proxied through the bridge; no cross-port challenge).
 */
class BrowserAppBridgeClient implements RendererApiTransport {
  private readonly bridgeOrigin = window.location.origin;
  private readonly listeners = new Map<RendererEventChannel, Set<RendererEventCallback>>();
  private disconnectEventStream: (() => void) | null = null;
  private readonly platform = detectPlatform();
  readonly api: ElectronAPI;

  constructor() {
    this.api = createRendererApi(this.platform, this);
  }

  async invoke<TResult>(channel: RendererInvokeChannel, ...args: unknown[]): Promise<TResult> {
    const response = await fetch(`${this.bridgeOrigin}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rdc-invoke-channel': channel,
      },
      credentials: 'include',
      body: JSON.stringify({ channel, args }),
    });

    const payload = await response.json() as { success?: boolean; result?: TResult; error?: string };
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || `Bridge invoke failed for ${channel}`);
    }
    if (channel === 'capture:readLivePreview' || channel === 'capture:readReplayImage') {
      const bytes = payload.result as { type?: unknown; data?: unknown } | null;
      if (bytes?.type !== 'Buffer' || !Array.isArray(bytes.data)
        || !bytes.data.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) {
        throw new Error('BRIDGE_INVALID_IMAGE_BYTES');
      }
      return Uint8Array.from(bytes.data) as TResult;
    }
    return payload.result as TResult;
  }

  subscribe(channel: RendererEventChannel, callback: RendererEventCallback): () => void {
    this.addListener(channel, callback);
    return () => this.removeListener(channel, callback);
  }

  addListener(channel: RendererEventChannel, callback: RendererEventCallback): void {
    const channelListeners = this.listeners.get(channel) ?? new Set<RendererEventCallback>();
    channelListeners.add(callback);
    this.listeners.set(channel, channelListeners);
    this.ensureEventStream();
  }

  removeListener(channel: RendererEventChannel, callback: RendererEventCallback): void {
    const channelListeners = this.listeners.get(channel);
    if (!channelListeners) return;
    channelListeners.delete(callback);
    if (channelListeners.size === 0) this.listeners.delete(channel);
    this.stopEventStreamIfIdle();
  }

  removeAllListeners(channel: RendererEventChannel): void {
    this.listeners.delete(channel);
    this.stopEventStreamIfIdle();
  }

  private ensureEventStream(): void {
    if (this.disconnectEventStream) return;
    const eventsUrl = new URL('/events', this.bridgeOrigin);
    this.disconnectEventStream = connectBrowserEventStream(eventsUrl.toString(), (payload) => {
      const channelListeners = this.listeners.get(payload.channel);
      if (!channelListeners) return;
      for (const listener of channelListeners) listener(...(payload.args ?? []));
    });
  }

  private stopEventStreamIfIdle(): void {
    if (this.listeners.size > 0 || !this.disconnectEventStream) return;
    this.disconnectEventStream();
    this.disconnectEventStream = null;
  }
}

export function installBrowserAppBridge(): void {
  if (typeof window === 'undefined') return;

  const target = window as BrowserBridgeWindow;
  if (window.electronAPI || target[BRIDGE_MARKER]) return;

  const client = new BrowserAppBridgeClient();
  window.electronAPI = client.api;
  target[BRIDGE_MARKER] = true;
}
