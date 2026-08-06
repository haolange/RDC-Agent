/**
 * Security contract suite - Bridge auth, secret isolation, MCP trust.
 * Phase 7 matrix entry; deeper cases live beside bridgeSecurity / McpTrustService.
 */
import { describe, expect, it, vi } from 'vitest';
import { RENDERER_INVOKE_CHANNELS } from '@shared/renderer-api';
import { resolveBridgeChannelCapability } from '@shared/renderer-api/channelCapabilities';
import {
  createBridgeBearerToken,
  isBridgeChannelAllowed,
  isOriginAllowed,
  tokensMatch,
} from '../../browserAppBridge/bridgeSecurity';
import {
  mcpExecutableFingerprint,
  projectOverridesUserExecutable,
} from '../../settings/McpTrustService';
import type { AgentRuntimeMcpDescriptor } from '@shared/types/agentRuntime';

vi.mock('../../ipc/invokeRegistry', () => ({
  hasRegisteredIpcChannel: () => true,
}));

describe('securityContract: browser bridge', () => {
  it('requires matching bearer tokens (failure-class: security)', () => {
    const token = createBridgeBearerToken();
    expect(token).toHaveLength(64);
    expect(tokensMatch(token, null)).toBe(false);
    expect(tokensMatch(token, token)).toBe(true);
  });

  it('exposes read/mutation/high-impact channels with FULL_ACCESS, never desktop-only', () => {
    const previousFullAccess = process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS;
    process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS = '1';
    try {
      for (const channel of RENDERER_INVOKE_CHANNELS) {
        const capability = resolveBridgeChannelCapability(channel);
        if (capability === 'desktop-only') {
          expect(isBridgeChannelAllowed(channel), channel).toBe(false);
        } else {
          expect(isBridgeChannelAllowed(channel), channel).toBe(true);
        }
      }
    } finally {
      if (previousFullAccess === undefined) delete process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS;
      else process.env.RDC_AGENT_BROWSER_QA_FULL_ACCESS = previousFullAccess;
    }
  });

  it('rejects non-allowlisted origins', () => {
    const allowed = new Set(['http://127.0.0.1:7788']);
    expect(isOriginAllowed('http://evil.example', allowed)).toBe(false);
    expect(isOriginAllowed('http://127.0.0.1:7788', allowed)).toBe(true);
  });

  it('allows secret status but rejects nonexistent raw-secret and unknown channels', () => {
    expect(isBridgeChannelAllowed('settings:getProviderSecret')).toBe(false);
    expect(isBridgeChannelAllowed('settings:hasProviderSecret')).toBe(true);
    expect(isBridgeChannelAllowed('future:dangerous')).toBe(false);
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
