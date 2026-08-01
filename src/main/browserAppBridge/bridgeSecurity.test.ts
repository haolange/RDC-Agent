import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RENDERER_INVOKE_CHANNELS } from '@shared/renderer-api';
import {
  buildBridgeAuthCookie,
  createBridgeBearerToken,
  extractBearerToken,
  isBridgeChannelAllowed,
  isOriginAllowed,
  resolveBridgeAllowedOrigins,
  resolveBridgeCookieToken,
  resolveBridgeQueryToken,
  resolveProvidedBridgeToken,
  tokensMatch,
} from './bridgeSecurity';

const { hasRegisteredIpcChannelMock } = vi.hoisted(() => ({
  hasRegisteredIpcChannelMock: vi.fn<(channel: string) => boolean>(() => true),
}));

vi.mock('../ipc/invokeRegistry', () => ({
  hasRegisteredIpcChannel: hasRegisteredIpcChannelMock,
}));

describe('browserAppBridge security', () => {
  beforeEach(() => {
    hasRegisteredIpcChannelMock.mockReset();
    hasRegisteredIpcChannelMock.mockReturnValue(true);
  });

  it('creates a 256-bit bearer token', () => {
    const token = createBridgeBearerToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects missing or mismatched bearer tokens', () => {
    const token = createBridgeBearerToken();
    expect(tokensMatch(token, null)).toBe(false);
    expect(tokensMatch(token, 'deadbeef')).toBe(false);
    expect(tokensMatch(token, extractBearerToken(`Bearer ${token}`, null))).toBe(true);
    expect(tokensMatch(token, extractBearerToken(undefined, token))).toBe(true);
  });

  it('resolves printed /app rdcBridgeToken query before bare token', () => {
    const printed = new URL('http://127.0.0.1:5127/app?rdcBridgeToken=abc123');
    expect(resolveBridgeQueryToken(printed)).toBe('abc123');
    const probe = new URL('http://127.0.0.1:5127/health?token=probe-token');
    expect(resolveBridgeQueryToken(probe)).toBe('probe-token');
    const both = new URL('http://127.0.0.1:5127/app?rdcBridgeToken=primary&token=secondary');
    expect(resolveBridgeQueryToken(both)).toBe('primary');
  });

  it('reads bridge auth cookie set by /qa entry', () => {
    expect(resolveBridgeCookieToken('rdcBridgeToken=abc%2F123; other=1')).toBe('abc/123');
    expect(resolveBridgeCookieToken('other=1')).toBeNull();
    expect(buildBridgeAuthCookie('secret')).toContain('rdcBridgeToken=secret');
  });

  it('resolves auth triad Bearer -> query -> cookie', () => {
    const url = new URL('http://127.0.0.1:5127/app');
    expect(resolveProvidedBridgeToken({
      authorizationHeader: 'Bearer from-header',
      url,
      cookieHeader: 'rdcBridgeToken=from-cookie',
    })).toBe('from-header');

    const withQuery = new URL('http://127.0.0.1:5127/app?rdcBridgeToken=from-query');
    expect(resolveProvidedBridgeToken({
      url: withQuery,
      cookieHeader: 'rdcBridgeToken=from-cookie',
    })).toBe('from-query');

    expect(resolveProvidedBridgeToken({
      url,
      cookieHeader: 'rdcBridgeToken=from-cookie',
    })).toBe('from-cookie');
    expect(resolveProvidedBridgeToken({ url })).toBeNull();
  });

  it('allows every registered renderer API channel through the browser transport', () => {
    for (const channel of RENDERER_INVOKE_CHANNELS) {
      expect(isBridgeChannelAllowed(channel), channel).toBe(true);
    }
  });

  it('fails closed for unknown, internal, raw-secret, and unregistered channels', () => {
    expect(isBridgeChannelAllowed('settings:getProviderSecret')).toBe(false);
    expect(isBridgeChannelAllowed('future:dangerous')).toBe(false);
    expect(isBridgeChannelAllowed('ipc:internal')).toBe(false);

    hasRegisteredIpcChannelMock.mockReturnValue(false);
    expect(isBridgeChannelAllowed('settings:get')).toBe(false);
  });

  it('uses an exact Origin allowlist without private-network wildcard CORS', () => {
    const allowed = resolveBridgeAllowedOrigins('http://127.0.0.1:5127', 'http://127.0.0.1:5173/');
    expect(allowed.has('http://127.0.0.1:5127')).toBe(true);
    expect(allowed.has('http://127.0.0.1:5173')).toBe(true);
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
  });
});
