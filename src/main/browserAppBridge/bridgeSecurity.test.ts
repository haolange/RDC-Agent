import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RENDERER_INVOKE_CHANNELS } from '@shared/renderer-api';
import { resolveBridgeChannelCapability } from '@shared/renderer-api/channelCapabilities';
import {
  buildBridgeAuthCookie,
  createBridgeBearerToken,
  extractBearerToken,
  isBridgeChannelAllowed,
  isOriginAllowed,
  resolveBridgeAllowedOrigins,
  resolveBridgeCookieToken,
  resolveProvidedBridgeToken,
  tokensMatch,
  cookieOriginRequiredForPath,
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
    delete process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS;
  });

  it('creates a 256-bit bearer token', () => {
    const token = createBridgeBearerToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects missing or mismatched bearer tokens', () => {
    const token = createBridgeBearerToken();
    expect(tokensMatch(token, null)).toBe(false);
    expect(tokensMatch(token, 'deadbeef')).toBe(false);
    expect(tokensMatch(token, extractBearerToken(`Bearer ${token}`))).toBe(true);
    expect(tokensMatch(token, extractBearerToken(undefined))).toBe(false);
  });

  it('does not accept bridge tokens from URL query parameters', () => {
    expect(resolveProvidedBridgeToken({
      cookieHeader: 'rdcBridgeToken=from-cookie',
    })).toBe('from-cookie');
    expect(resolveProvidedBridgeToken({
      cookieHeader: undefined,
    })).toBeNull();
  });

  it('reads an HttpOnly strict bridge auth cookie set by /qa entry', () => {
    expect(resolveBridgeCookieToken('rdcBridgeToken=abc%2F123; other=1')).toBe('abc/123');
    expect(resolveBridgeCookieToken('other=1')).toBeNull();
    expect(buildBridgeAuthCookie('secret')).toContain('rdcBridgeToken=secret');
    expect(buildBridgeAuthCookie('secret')).toContain('HttpOnly');
    expect(buildBridgeAuthCookie('secret')).toContain('SameSite=Strict');
    expect(buildBridgeAuthCookie('secret', { secure: true })).toContain('Secure');
  });

  it('resolves auth from Bearer before cookie', () => {
    expect(resolveProvidedBridgeToken({
      authorizationHeader: 'Bearer from-header',
      cookieHeader: 'rdcBridgeToken=from-cookie',
    })).toBe('from-header');
    expect(resolveProvidedBridgeToken({
      cookieHeader: 'rdcBridgeToken=from-cookie',
    })).toBe('from-cookie');
    expect(resolveProvidedBridgeToken({})).toBeNull();
  });

  it('keeps ordinary registered renderer channels available to the browser transport', () => {
    const ordinaryChannels = RENDERER_INVOKE_CHANNELS.filter((channel) => {
      const capability = resolveBridgeChannelCapability(channel);
      return capability === 'read' || capability === 'mutation';
    });
    for (const channel of ordinaryChannels) {
      expect(isBridgeChannelAllowed(channel), channel).toBe(true);
    }
  });

  it('requires full-access opt-in for high-risk browser channels', () => {
    for (const channel of ['command:execute', 'settings:set', 'rdc-runtime:trustMcp', 'rdc-runtime:revokeMcp', 'memory:issueApprovalToken']) {
      expect(isBridgeChannelAllowed(channel), channel).toBe(false);
    }
    process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS = '1';
    for (const channel of ['command:execute', 'settings:set', 'rdc-runtime:trustMcp', 'rdc-runtime:revokeMcp', 'memory:issueApprovalToken']) {
      expect(isBridgeChannelAllowed(channel), channel).toBe(true);
    }
    // desktop-only stays denied even with FULL_ACCESS
    expect(isBridgeChannelAllowed('window:close')).toBe(false);
    expect(isBridgeChannelAllowed('web:resolveFavicon')).toBe(false);
    expect(isBridgeChannelAllowed('dialog:selectDirectory')).toBe(true);
    expect(isBridgeChannelAllowed('app:copyText')).toBe(true);
    expect(isBridgeChannelAllowed('app:readClipboardText')).toBe(true);
  });

  it('fails closed for unknown, internal, raw-secret, and unregistered channels', () => {
    expect(isBridgeChannelAllowed('settings:getProviderSecret')).toBe(false);
    expect(isBridgeChannelAllowed('future:dangerous')).toBe(false);
    expect(isBridgeChannelAllowed('ipc:internal')).toBe(false);

    hasRegisteredIpcChannelMock.mockReturnValue(false);
    expect(isBridgeChannelAllowed('settings:get')).toBe(false);
  });

  it('uses an exact bridge-only Origin allowlist (dev renderer is not a cookie peer)', () => {
    const allowed = resolveBridgeAllowedOrigins('http://127.0.0.1:5127', 'http://127.0.0.1:54431/');
    expect(allowed.has('http://127.0.0.1:5127')).toBe(true);
    expect(allowed.has('http://127.0.0.1:54431')).toBe(false);
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
    expect(isOriginAllowed(undefined, allowed, {
      authViaCookie: true,
      bridgeOrigin: 'http://127.0.0.1:5127',
    })).toBe(false);
    expect(isOriginAllowed('http://127.0.0.1:5127', allowed, {
      authViaCookie: true,
      bridgeOrigin: 'http://127.0.0.1:5127',
    })).toBe(true);
  });

  it('requires cookie Origin for /invoke, /events, and /api/*', () => {
    expect(cookieOriginRequiredForPath('/invoke')).toBe(true);
    expect(cookieOriginRequiredForPath('/events')).toBe(true);
    expect(cookieOriginRequiredForPath('/api/settings/providers/catalog')).toBe(true);
    expect(cookieOriginRequiredForPath('/health')).toBe(false);
    expect(cookieOriginRequiredForPath('/app')).toBe(false);
  });
});
