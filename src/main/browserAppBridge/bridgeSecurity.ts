import { randomBytes, timingSafeEqual } from 'crypto';
import { isRendererInvokeChannel } from '@shared/renderer-api';
import { hasRegisteredIpcChannel } from '../ipc/invokeRegistry';

/**
 * Browser QA is not a generic ipcMain proxy. It exposes exactly the product
 * API available through the desktop preload, while main-process validation,
 * permissions, trust, and secret isolation remain authoritative.
 */
export function isBridgeChannelAllowed(channel: string): boolean {
  if (!isRendererInvokeChannel(channel) || !hasRegisteredIpcChannel(channel)) {
    return false;
  }
  if (isBridgeHighRiskChannel(channel) && process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS !== '1') {
    return false;
  }
  return true;
}

/** Browser QA requires an explicit second opt-in for high-impact mutations. */
export const BRIDGE_HIGH_RISK_CHANNELS = new Set<string>([
  'command:execute',
  'settings:set',
  'rdx-runtime:trustMcp',
  'rdx-runtime:revokeMcp',
]);

export function isBridgeHighRiskChannel(channel: string): boolean {
  return BRIDGE_HIGH_RISK_CHANNELS.has(channel) || channel.startsWith('terminal:');
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

export function resolveBridgeAllowedOrigins(bridgeOrigin: string, devRendererUrl: string | null): Set<string> {
  const allowed = new Set<string>([bridgeOrigin]);
  if (devRendererUrl) {
    try {
      allowed.add(new URL(devRendererUrl).origin);
    } catch {
      // Ignore invalid renderer URLs.
    }
  }
  return allowed;
}

export function isOriginAllowed(originHeader: string | undefined, allowedOrigins: Set<string>): boolean {
  if (!originHeader) {
    // Same-origin navigations and non-browser clients may omit Origin.
    return true;
  }
  return allowedOrigins.has(originHeader);
}
