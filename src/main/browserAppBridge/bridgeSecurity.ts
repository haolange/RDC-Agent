import { randomBytes, timingSafeEqual } from 'crypto';
import { isRendererInvokeChannel } from '@shared/renderer-api';
import { hasRegisteredIpcChannel } from '../ipc/invokeRegistry';

/**
 * Browser QA is not a generic ipcMain proxy. It exposes exactly the product
 * API available through the desktop preload, while main-process validation,
 * permissions, trust, and secret isolation remain authoritative.
 */
export function isBridgeChannelAllowed(channel: string): boolean {
  return isRendererInvokeChannel(channel) && hasRegisteredIpcChannel(channel);
}

export function createBridgeBearerToken(): string {
  return randomBytes(32).toString('hex');
}

export function extractBearerToken(authorizationHeader: string | undefined, queryToken: string | null): string | null {
  const header = authorizationHeader?.trim();
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (match?.[1]) return match[1].trim();
  }
  const fromQuery = queryToken?.trim();
  return fromQuery || null;
}

/** Prefer the printed /app query name; keep bare `token` for invoke/health probes. */
export function resolveBridgeQueryToken(url: URL): string | null {
  return url.searchParams.get('rdcBridgeToken') ?? url.searchParams.get('token');
}

/** Resolve Browser QA auth in order: Bearer, query token, then auth cookie. */
export function resolveProvidedBridgeToken(input: {
  authorizationHeader?: string;
  url: URL;
  cookieHeader?: string;
}): string | null {
  return extractBearerToken(
    input.authorizationHeader,
    resolveBridgeQueryToken(input.url),
  ) ?? resolveBridgeCookieToken(input.cookieHeader);
}

const BRIDGE_COOKIE_NAME = 'rdcBridgeToken';

/** Cookie used by short `/qa` entry so the address bar does not retain the bearer token. */
export function resolveBridgeCookieToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(`${BRIDGE_COOKIE_NAME}=`)) continue;
    const raw = trimmed.slice(BRIDGE_COOKIE_NAME.length + 1).trim();
    if (!raw) return null;
    try {
      return decodeURIComponent(raw) || null;
    } catch {
      return raw;
    }
  }
  return null;
}

export function buildBridgeAuthCookie(token: string): string {
  // QA-only localhost bridge: readable by renderer so /invoke can send Bearer.
  return `${BRIDGE_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=Lax`;
}

export { BRIDGE_COOKIE_NAME };

export function tokensMatch(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function resolveBridgeAllowedOrigins(bridgeOrigin: string, devRendererUrl: string | null): Set<string> {
  const allowed = new Set<string>([bridgeOrigin]);
  if (devRendererUrl) {
    try {
      allowed.add(new URL(devRendererUrl).origin);
    } catch {
      // Ignore invalid renderer URLs.
    }
  }
  // Vite browser-dev default; keep exact-origin only (no wildcard).
  allowed.add('http://127.0.0.1:5173');
  return allowed;
}

export function isOriginAllowed(originHeader: string | undefined, allowedOrigins: Set<string>): boolean {
  if (!originHeader) {
    // Same-origin navigations and non-browser clients may omit Origin.
    return true;
  }
  return allowedOrigins.has(originHeader);
}
