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

function resolveBridgeOrigin(): string {
  const explicitOrigin = new URL(window.location.href).searchParams.get('rdcBridgeOrigin');
  return explicitOrigin || window.location.origin;
}

function resolveBridgeChallenge(): string | null {
  return new URL(window.location.href).searchParams.get('rdcBridgeChallenge')?.trim() || null;
}

function detectPlatform(): NodeJS.Platform {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) return 'win32';
  if (platform.includes('mac')) return 'darwin';
  if (platform.includes('linux')) return 'linux';
  return 'browser' as NodeJS.Platform;
}

class BrowserAppBridgeClient implements RendererApiTransport {
  private readonly bridgeOrigin = resolveBridgeOrigin();
  private readonly bridgeChallenge = resolveBridgeChallenge();
  private readonly listeners = new Map<RendererEventChannel, Set<RendererEventCallback>>();
  private eventSource: EventSource | null = null;
  private readonly platform = detectPlatform();
  private readonly handshakePromise: Promise<void>;
  readonly api: ElectronAPI;

  constructor() {
    this.handshakePromise = this.bridgeChallenge
      ? this.handshake(this.bridgeChallenge)
      : Promise.resolve();
    this.api = createRendererApi(this.platform, this);
  }

  async invoke<TResult>(channel: RendererInvokeChannel, ...args: unknown[]): Promise<TResult> {
    await this.handshakePromise;
    const response = await fetch(`${this.bridgeOrigin}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
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
    void this.handshakePromise.then(() => {
      if (this.eventSource) return;
      const eventsUrl = new URL('/events', this.bridgeOrigin);
      this.eventSource = new EventSource(eventsUrl.toString(), { withCredentials: true });
      this.eventSource.onmessage = (event) => {
        const payload = JSON.parse(event.data) as { channel: RendererEventChannel; args?: unknown[] };
        const channelListeners = this.listeners.get(payload.channel);
        if (!channelListeners) return;
        for (const listener of channelListeners) listener(...(payload.args ?? []));
      };
    }).catch((error) => {
      console.error('[BrowserAppBridge] Dev renderer handshake failed', error);
    });
  }

  private async handshake(challenge: string): Promise<void> {
    const response = await fetch(`${this.bridgeOrigin}/dev-renderer/handshake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ challenge }),
    });
    const payload = await response.json() as { success?: boolean; error?: string };
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || 'Dev renderer handshake failed.');
    }
    try {
      const current = new URL(window.location.href);
      current.searchParams.delete('rdcBridgeChallenge');
      current.searchParams.delete('rdcBridgeOrigin');
      window.history?.replaceState?.({}, '', current.toString());
    } catch {
      // The bridge cookie is authoritative; URL cleanup is defense in depth.
    }
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
