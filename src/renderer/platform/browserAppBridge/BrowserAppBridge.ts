import type { ElectronAPI } from '@shared/types/electron';
import {
  createRendererApi,
  type RendererApiTransport,
  type RendererEventCallback,
  type RendererEventChannel,
  type RendererInvokeChannel,
} from '@shared/renderer-api';

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
  private eventSource: EventSource | null = null;
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
    return payload.result as TResult;
  }

  subscribe(channel: RendererEventChannel, callback: RendererEventCallback): () => void {
    this.addListener(channel, callback);
    return () => this.removeListener(channel, callback);
  }

  addListener(channel: RendererEventChannel, callback: RendererEventCallback): void {
    this.ensureEventSource();
    const channelListeners = this.listeners.get(channel) ?? new Set<RendererEventCallback>();
    channelListeners.add(callback);
    this.listeners.set(channel, channelListeners);
  }

  removeListener(channel: RendererEventChannel, callback: RendererEventCallback): void {
    const channelListeners = this.listeners.get(channel);
    if (!channelListeners) return;
    channelListeners.delete(callback);
    if (channelListeners.size === 0) this.listeners.delete(channel);
  }

  removeAllListeners(channel: RendererEventChannel): void {
    this.listeners.delete(channel);
  }

  private ensureEventSource(): void {
    if (this.eventSource) return;
    const eventsUrl = new URL('/events', this.bridgeOrigin);
    this.eventSource = new EventSource(eventsUrl.toString(), { withCredentials: true });
    this.eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { channel: RendererEventChannel; args?: unknown[] };
      const channelListeners = this.listeners.get(payload.channel);
      if (!channelListeners) return;
      for (const listener of channelListeners) listener(...(payload.args ?? []));
    };
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
