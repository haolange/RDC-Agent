/**
 * Security contract suite — Bridge auth, secret isolation, MCP trust.
 * Phase 7 matrix entry; deeper cases live beside bridgeSecurity / McpTrustService.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createBridgeBearerToken,
  isBridgeChannelDenied,
  isOriginAllowed,
  tokensMatch,
} from '../../browserAppBridge/bridgeSecurity';
import {
  mcpExecutableFingerprint,
  projectOverridesUserExecutable,
} from '../../settings/McpTrustService';
import type { AgentRuntimeMcpDescriptor } from '@shared/types/agentRuntime';

vi.mock('../../ipc/invokeRegistry', () => ({
  hasRegisteredIpcChannel: (channel: string) => [
    'settings:get',
    'settings:hasProviderSecret',
    'settings:getProviderSecret',
    'terminal:write',
    'memory:list',
    'mcp:getStatusSummary',
    'command:execute',
    'conversation:answerToolApproval',
    'rdx-runtime:trustMcp',
    'conversation:getHistory',
  ].includes(channel),
}));

describe('securityContract: browser bridge', () => {
  it('requires matching bearer tokens (failure-class: security)', () => {
    const token = createBridgeBearerToken();
    expect(token).toHaveLength(64);
    expect(tokensMatch(token, null)).toBe(false);
    expect(tokensMatch(token, token)).toBe(true);
  });

  it('denies secret/terminal/mcp/trust channels on bridge', async () => {
    const { isBridgeChannelAllowed } = await import('../../browserAppBridge/bridgeSecurity');
    for (const channel of [
      'settings:getProviderSecret',
      'terminal:write',
      'memory:list',
      'mcp:getStatusSummary',
      'command:execute',
      'conversation:answerToolApproval',
      'rdx-runtime:trustMcp',
    ]) {
      expect(isBridgeChannelDenied(channel)).toBe(true);
      expect(isBridgeChannelAllowed(channel)).toBe(false);
    }
    expect(isBridgeChannelAllowed('settings:get')).toBe(true);
  });

  it('rejects non-allowlisted origins', () => {
    const allowed = new Set(['http://127.0.0.1:7788']);
    expect(isOriginAllowed('http://evil.example', allowed)).toBe(false);
    expect(isOriginAllowed('http://127.0.0.1:7788', allowed)).toBe(true);
  });

  it('allows hasProviderSecret but permanently denies getProviderSecret', async () => {
    const { isBridgeChannelAllowed } = await import('../../browserAppBridge/bridgeSecurity');
    expect(isBridgeChannelDenied('settings:getProviderSecret')).toBe(true);
    expect(isBridgeChannelAllowed('settings:getProviderSecret')).toBe(false);
    expect(isBridgeChannelDenied('settings:hasProviderSecret')).toBe(false);
    expect(isBridgeChannelAllowed('settings:hasProviderSecret')).toBe(true);
  });

  it('issues unique bearer tokens per call', () => {
    const a = createBridgeBearerToken();
    const b = createBridgeBearerToken();
    expect(a).not.toBe(b);
    expect(tokensMatch(a, b)).toBe(false);
  });
});

describe('securityContract: MCP trust fingerprints', () => {
  const base: AgentRuntimeMcpDescriptor = {
    id: 'docs',
    name: 'Docs',
    description: '',
    transport: 'stdio',
    enabledByDefault: true,
    command: 'npx',
    args: ['-y', 'demo'],
    env: {},
    scope: 'user',
    sourcePath: 'user://mcp/docs',
    sourceHash: 'h1',
  };

  it('detects project executable override of user MCP (failure-class: security)', () => {
    const project: AgentRuntimeMcpDescriptor = {
      ...base,
      scope: 'project',
      args: ['-y', 'evil'],
    };
    expect(projectOverridesUserExecutable(base, project)).toBe(true);
    expect(mcpExecutableFingerprint(base)).not.toBe(mcpExecutableFingerprint(project));
    expect(projectOverridesUserExecutable(base, { ...base, scope: 'project' })).toBe(false);
  });
});
