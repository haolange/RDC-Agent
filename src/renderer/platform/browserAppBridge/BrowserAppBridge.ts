import type { ElectronAPI } from '@shared/types/electron';
import {
  createRendererApi,
  type RendererApiTransport,
  type RendererEventCallback,
  type RendererEventChannel,
  type RendererInvokeChannel,
} from '@shared/renderer-api';

const BRIDGE_MARKER = '__RDC_AGENT_BROWSER_APP_BRIDGE__';
const BRIDGE_TOKEN_STORAGE_KEY = 'rdcBridgeToken';

type BrowserBridgeWindow = Window & {
  [BRIDGE_MARKER]?: true;
};

function resolveBridgeOrigin(): string {
  const explicitOrigin = new URL(window.location.href).searchParams.get('rdcBridgeOrigin');
  return explicitOrigin || window.location.origin;
}

function readBridgeCookieToken(): string {
  if (typeof document === 'undefined') return '';
  const prefix = `${BRIDGE_TOKEN_STORAGE_KEY}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(prefix)) continue;
    try {
      return decodeURIComponent(trimmed.slice(prefix.length)).trim();
    } catch {
      return trimmed.slice(prefix.length).trim();
    }
  }
  return '';
}

function resolveBridgeToken(): string {
  const params = new URL(window.location.href).searchParams;
  const fromQuery = params.get('rdcBridgeToken')?.trim();
  if (fromQuery) {
    try {
      sessionStorage.setItem(BRIDGE_TOKEN_STORAGE_KEY, fromQuery);
    } catch {
      // sessionStorage may be unavailable; keep using the query token for this page.
    }
    return fromQuery;
  }

  const fromCookie = readBridgeCookieToken();
  if (fromCookie) {
    try {
      sessionStorage.setItem(BRIDGE_TOKEN_STORAGE_KEY, fromCookie);
    } catch {
      // Ignore storage failures; the cookie remains authoritative.
    }
    return fromCookie;
  }

  try {
    return sessionStorage.getItem(BRIDGE_TOKEN_STORAGE_KEY)?.trim() || '';
  } catch {
    return '';
  }
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
  private readonly bridgeToken = resolveBridgeToken();
  private readonly listeners = new Map<RendererEventChannel, Set<RendererEventCallback>>();
  private eventSource: EventSource | null = null;
  private readonly platform = detectPlatform();
  readonly api: ElectronAPI;

  constructor() {
    this.api = createRendererApi(this.platform, this);
  }

  async invoke<TResult>(channel: RendererInvokeChannel, ...args: unknown[]): Promise<TResult> {
    if (!this.bridgeToken) {
      throw new Error('Browser bridge token is missing; open the /qa URL printed by the headless main process.');
    }
    const response = await fetch(`${this.bridgeOrigin}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.bridgeToken}`,
      },
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
    if (!this.bridgeToken) {
      throw new Error('Browser bridge token is missing; open the /qa URL printed by the headless main process.');
    }
    const eventsUrl = new URL('/events', this.bridgeOrigin);
    eventsUrl.searchParams.set('token', this.bridgeToken);
    this.eventSource = new EventSource(eventsUrl.toString());
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
