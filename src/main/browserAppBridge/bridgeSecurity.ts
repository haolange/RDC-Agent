import { randomBytes, timingSafeEqual } from 'crypto';
import { isRendererInvokeChannel } from '@shared/renderer-api';
import { resolveBridgeChannelCapability } from '@shared/renderer-api/channelCapabilities';
import { hasRegisteredIpcChannel } from '../ipc/invokeRegistry';

/**
 * Browser QA is not a generic ipcMain proxy. It exposes exactly the product
 * API available through the desktop preload, while main-process validation,
 * permissions, trust, and secret isolation remain authoritative.
 *
 * Capability matrix (with channels.ts):
 * - read | mutation: default allow
 * - high-impact: requires RDC_AGENT_BROWSER_QA_FULL_ACCESS=1
 * - desktop-only: always denied
 */
export function isBridgeChannelAllowed(channel: string): boolean {
  if (!isRendererInvokeChannel(channel) || !hasRegisteredIpcChannel(channel)) {
    return false;
  }
  const capability = resolveBridgeChannelCapability(channel);
  if (capability === 'desktop-only') {
    return false;
  }
  if (capability === 'high-impact' && process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS !== '1') {
    return false;
  }
  return true;
}

/** @deprecated Prefer resolveBridgeChannelCapability — retained for tests that assert the high-impact set. */
export function isBridgeHighRiskChannel(channel: string): boolean {
  return resolveBridgeChannelCapability(channel) === 'high-impact';
}

export function createBridgeBearerToken(): string {
  return randomBytes(32).toString('hex');
}

export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  const header = authorizationHeader?.trim();
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

/** Resolve Browser QA auth from an explicit Bearer header or HttpOnly auth cookie. */
export function resolveProvidedBridgeToken(input: {
  authorizationHeader?: string;
  cookieHeader?: string;
}): string | null {
  return extractBearerToken(input.authorizationHeader) ?? resolveBridgeCookieToken(input.cookieHeader);
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

export function buildBridgeAuthCookie(token: string, options: { secure?: boolean } = {}): string {
  const secure = options.secure ? '; Secure' : '';
  return `${BRIDGE_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict${secure}`;
}

export { BRIDGE_COOKIE_NAME };

export function tokensMatch(expected: string, provided: string | null): boolean {
  if (!provided) return false;
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function resolveBridgeAllowedOrigins(bridgeOrigin: string, _devRendererUrl: string | null = null): Set<string> {
  // Cookie sessions and the renderer are same-origin to the bridge.
  // Vite is reverse-proxied and never appears as a peer Origin.
  return new Set<string>([bridgeOrigin]);
}

/**
 * Origin gate for bridge requests.
 * - Bearer auth: Origin may be omitted (non-browser / automation clients).
 * - Cookie auth: Origin must be present and exactly equal to bridgeOrigin.
 */
export function isOriginAllowed(
  originHeader: string | undefined,
  allowedOrigins: Set<string>,
  options: { authViaCookie?: boolean; bridgeOrigin?: string } = {},
): boolean {
  if (options.authViaCookie) {
    if (!originHeader || !options.bridgeOrigin) return false;
    return originHeader === options.bridgeOrigin && allowedOrigins.has(originHeader);
  }
  if (!originHeader) {
    return true;
  }
  return allowedOrigins.has(originHeader);
}
