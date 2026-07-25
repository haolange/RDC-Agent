import { describe, expect, it, vi } from 'vitest';
import {
  createBridgeBearerToken,
  extractBearerToken,
  isBridgeChannelAllowlisted,
  isBridgeChannelDenied,
  isOriginAllowed,
  resolveBridgeAllowedOrigins,
  tokensMatch,
} from './bridgeSecurity';

vi.mock('../ipc/invokeRegistry', () => ({
  hasRegisteredIpcChannel: (channel: string) => [
    'settings:get',
    'settings:hasProviderSecret',
    'settings:set',
    'settings:getProviderSecret',
    'settings:saveAgentDefinition',
    'terminal:write',
    'terminal:createTab',
    'memory:list',
    'mcp:getStatusSummary',
    'command:execute',
    'command:list',
    'conversation:getHistory',
    'conversation:answerToolApproval',
    'conversation:sendMessage',
    'rdx-runtime:trustMcp',
    'rdx-runtime:overview',
    'workflow:getState',
    'future:dangerous',
  ].includes(channel),
}));

describe('browserAppBridge security', () => {
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

  it('denies terminal, secret, memory, mcp, approval, execute, and settings mutation channels', async () => {
    const { isBridgeChannelAllowed } = await import('./bridgeSecurity');
    expect(isBridgeChannelDenied('terminal:write')).toBe(true);
    expect(isBridgeChannelDenied('settings:getProviderSecret')).toBe(true);
    expect(isBridgeChannelDenied('settings:set')).toBe(true);
    expect(isBridgeChannelDenied('memory:list')).toBe(true);
    expect(isBridgeChannelDenied('mcp:getStatusSummary')).toBe(true);
    expect(isBridgeChannelDenied('command:execute')).toBe(true);
    expect(isBridgeChannelDenied('conversation:answerToolApproval')).toBe(true);
    expect(isBridgeChannelDenied('rdx-runtime:trustMcp')).toBe(true);
    expect(isBridgeChannelAllowed('terminal:write')).toBe(false);
    expect(isBridgeChannelAllowed('settings:getProviderSecret')).toBe(false);
    expect(isBridgeChannelAllowed('command:execute')).toBe(false);
    expect(isBridgeChannelAllowed('future:dangerous')).toBe(false);
    expect(isBridgeChannelAllowlisted('future:dangerous')).toBe(false);
    expect(isBridgeChannelAllowed('settings:get')).toBe(true);
    expect(isBridgeChannelAllowed('settings:hasProviderSecret')).toBe(true);
    expect(isBridgeChannelAllowed('conversation:getHistory')).toBe(true);
    expect(isBridgeChannelAllowed('conversation:sendMessage')).toBe(true);
    expect(isBridgeChannelAllowed('command:list')).toBe(true);
    expect(isBridgeChannelAllowed('rdx-runtime:overview')).toBe(true);
    expect(isBridgeChannelAllowed('workflow:getState')).toBe(true);
    expect(isBridgeChannelDenied('settings:hasProviderSecret')).toBe(false);
  });

  it('uses an exact Origin allowlist without private-network wildcard CORS', () => {
    const allowed = resolveBridgeAllowedOrigins('http://127.0.0.1:5127', 'http://127.0.0.1:5173/');
    expect(allowed.has('http://127.0.0.1:5127')).toBe(true);
    expect(allowed.has('http://127.0.0.1:5173')).toBe(true);
    expect(isOriginAllowed('https://evil.example', allowed)).toBe(false);
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
  });
});
