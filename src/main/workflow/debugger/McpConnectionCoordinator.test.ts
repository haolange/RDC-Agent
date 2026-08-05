import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
  canonicalMcpProjectRoot,
  classifyMcpFailure,
  McpConnectionCoordinator,
} from './McpConnectionCoordinator';
import { agentRuntimeConfigService } from '../../settings/AgentRuntimeConfigService';
import { mcpTrustService } from '../../settings/McpTrustService';
import type { McpDisconnectDetail } from '../../agent-runtime/agent/MCPManager';
import { runtimeLogService } from '../../runtime/RuntimeLogService';
import type { SupervisedProcess } from '../../runtime/ProcessSupervisor';

function descriptor(id: string) {
  return {
    id,
    name: id,
    description: '',
    transport: 'stdio' as const,
    scope: 'user' as const,
    sourcePath: id,
    sourceHash: id,
    enabledByDefault: true,
  };
}
describe('McpConnectionCoordinator project ownership', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('normalizes project roots with realpath and includes project identity in pool keys', async () => {
    const resolved = path.resolve('Case-Sensitive-Project');
    const expectedLinux = (() => {
      try { return fs.realpathSync.native(resolved); } catch { return resolved; }
    })();
    const expectedWin = (() => {
      try { return fs.realpathSync.native(resolved).toLowerCase(); } catch { return resolved.toLowerCase(); }
    })();
    expect(canonicalMcpProjectRoot(resolved, 'linux')).toBe(expectedLinux);
    expect(canonicalMcpProjectRoot(resolved, 'darwin')).toBe(expectedLinux);
    expect(canonicalMcpProjectRoot(resolved, 'win32')).toBe(expectedWin);

    const d = descriptor('identity-server');
    vi.spyOn(agentRuntimeConfigService, 'listMcpServers').mockReturnValue([d]);
    const coordinator = new McpConnectionCoordinator();
    const first = await coordinator.acquireConnections('ask', resolved, [d.id], 'project-a');
    const second = await coordinator.acquireConnections('ask', resolved, [d.id], 'project-b');
    expect(first.lease?.poolKey).not.toBe(second.lease?.poolKey);
    expect(first.lease?.poolKey).toContain(encodeURIComponent('project-a'));
    expect(second.lease?.poolKey).toContain(encodeURIComponent('project-b'));
    expect(coordinator.getRuntimeStatusSummary(resolved, 'project-a')[0]?.id).toBe(d.id);
    expect(coordinator.getRuntimeStatusSummary(resolved, 'project-b')[0]?.id).toBe(d.id);
    await first.lease?.release({ discardIfIdle: true });
    await second.lease?.release({ discardIfIdle: true });
    await coordinator.disconnectAll();
  });

  it('evicts a project pool only after every turn lease is released', async () => {
    const root = path.resolve('shared-project');
    const d = descriptor('shared-server');
    vi.spyOn(agentRuntimeConfigService, 'listMcpServers').mockReturnValue([d]);
    const coordinator = new McpConnectionCoordinator();
    const first = await coordinator.acquireConnections('ask', root, [d.id]);
    const second = await coordinator.acquireConnections('ask', root, [d.id]);
    expect(coordinator.getRuntimeStatusSummary(root)[0]?.connectionStatus).toBe('error');
    await first.lease?.release({ discardIfIdle: true });
    expect(coordinator.getRuntimeStatusSummary(root)[0]?.connectionStatus).toBe('error');
    await second.lease?.release({ discardIfIdle: true });
    expect(coordinator.getRuntimeStatusSummary(root)).toEqual([]);
    await coordinator.disconnectAll();
  });

  it('keeps a turn bound to its leased pool when descriptors change', async () => {
    const root = path.resolve('descriptor-changing-project');
    const descriptorA = descriptor('descriptor-a');
    const descriptorB = { ...descriptorA, id: 'descriptor-b', name: 'descriptor-b', sourcePath: 'b', sourceHash: 'b' };
    let current = [descriptorA];
    vi.spyOn(agentRuntimeConfigService, 'listMcpServers').mockImplementation(() => current);
    const coordinator = new McpConnectionCoordinator();
    const first = await coordinator.acquireConnections('ask', root, [descriptorA.id]);
    const firstKey = first.lease?.poolKey;
    current = [descriptorB];
    const second = await coordinator.acquireConnections('ask', root, [descriptorB.id]);
    const secondKey = second.lease?.poolKey;
    expect(firstKey).toBeTruthy();
    expect(secondKey).toBeTruthy();
    expect(secondKey).not.toBe(firstKey);
    const pools = (coordinator as unknown as {
      pools: Map<string, { manager: { getAgentTools: () => unknown[] } }>;
    }).pools;
    const firstPool = pools.get(firstKey!);
    const secondPool = pools.get(secondKey!);
    expect(firstPool).toBeTruthy();
    expect(secondPool).toBeTruthy();
    vi.spyOn(firstPool!.manager, 'getAgentTools').mockReturnValue([{}]);
    vi.spyOn(secondPool!.manager, 'getAgentTools').mockReturnValue([{}, {}]);
    expect(coordinator.getAgentTools(root, firstKey)).toHaveLength(1);
    expect(coordinator.getAgentTools(root, secondKey)).toHaveLength(2);
    expect(coordinator.getAgentTools(path.resolve('other-project'), firstKey)).toEqual([]);
    await first.lease?.release({ discardIfIdle: true });
    await second.lease?.release({ discardIfIdle: true });
    await coordinator.disconnectAll();
  });

  it('keeps concurrent project pools isolated when a second project prepares', async () => {
    const rootA = path.resolve('test-project-a');
    const rootB = path.resolve('test-project-b');
    const descriptorA = descriptor('project-a-server');
    const descriptorB = descriptor('project-b-server');
    vi.spyOn(agentRuntimeConfigService, 'listMcpServers').mockImplementation((root) => (
      root && path.resolve(root) === rootB ? [descriptorB] : [descriptorA]
    ));
    const coordinator = new McpConnectionCoordinator();
    const leaseA = await coordinator.acquireConnections('ask', rootA, [descriptorA.id]);
    expect(leaseA.errors).toHaveLength(1);
    expect(coordinator.getRuntimeStatusSummary(rootA)[0]?.connectionStatus).toBe('error');
    const leaseB = await coordinator.acquireConnections('ask', rootB, [descriptorB.id]);
    expect(leaseB.errors).toHaveLength(1);
    expect(coordinator.getRuntimeStatusSummary(rootB)[0]?.connectionStatus).toBe('error');
    expect(coordinator.getRuntimeStatusSummary(rootA)[0]?.id).toBe(descriptorA.id);
    expect(coordinator.getRuntimeStatusSummary(rootA)[0]?.connectionStatus).toBe('error');
    await leaseA.lease?.release({ discardIfIdle: true });
    await leaseB.lease?.release({ discardIfIdle: true });
    await coordinator.disconnectAll();
  });
});
describe('McpConnectionCoordinator failure cache', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('classifies trust and missing-command failures as permanent', () => {
    expect(classifyMcpFailure(new Error('Project MCP "x" needs trust for projectRealpath+descriptorHash before connect.'))).toBe('permanent');
    expect(classifyMcpFailure(new Error('MCP_TRANSPORT_UNSUPPORTED: sse'))).toBe('permanent');
    expect(classifyMcpFailure(new Error('MCP stdio server "x" missing command'))).toBe('permanent');
    expect(classifyMcpFailure(new Error('connect ECONNREFUSED 127.0.0.1:9'))).toBe('retryable');
    expect(classifyMcpFailure(new Error('spawn ENOENT'))).toBe('retryable');
  });

  it('defers retryable failures with exponential backoff and promotes after 5 attempts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const root = path.resolve('retry-project');
    const d2 = { ...descriptor('retryable-server'), command: 'node' };
    vi.spyOn(agentRuntimeConfigService, 'listMcpServers').mockReturnValue([d2]);
    const { MCPManager } = await import('../../agent-runtime/agent/MCPManager');
    const connectSpy = vi.spyOn(MCPManager.prototype, 'connect')
      .mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:9'));
    const coordinator2 = new McpConnectionCoordinator();

    const a1 = await coordinator2.acquireConnections('ask', root, [d2.id], 'p2');
    expect(a1.errors[0]).toContain('ECONNREFUSED');
    const pool2 = (coordinator2 as unknown as {
      pools: Map<string, { failedMcpServers: Map<string, { kind: string; attempts: number; nextRetryAt: number }> }>;
    }).pools.get(a1.lease!.poolKey)!;
    const r1 = pool2.failedMcpServers.get(d2.id)!;
    expect(r1.kind).toBe('retryable');
    expect(r1.attempts).toBe(1);
    expect(r1.nextRetryAt).toBe(Date.now() + 2_000);

    connectSpy.mockClear();
    const a2 = await coordinator2.acquireConnections('ask', root, [d2.id], 'p2');
    expect(a2.errors[0]).toMatch(/retry deferred/);
    expect(connectSpy).not.toHaveBeenCalled();
    await a2.lease?.release({ discardIfIdle: false });

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      vi.setSystemTime(new Date(Date.now() + 120_000));
      connectSpy.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:9'));
      const a = await coordinator2.acquireConnections('ask', root, [d2.id], 'p2');
      expect(a.errors[0]).toContain('ECONNREFUSED');
      const rec = pool2.failedMcpServers.get(d2.id)!;
      expect(rec.attempts).toBe(attempt);
      if (attempt < 5) expect(rec.kind).toBe('retryable');
      else expect(rec.kind).toBe('permanent');
      await a.lease?.release({ discardIfIdle: false });
    }

    connectSpy.mockClear();
    const blocked = await coordinator2.acquireConnections('ask', root, [d2.id], 'p2');
    expect(blocked.errors[0]).toContain('ECONNREFUSED');
    expect(connectSpy).not.toHaveBeenCalled();

    await a1.lease?.release({ discardIfIdle: true });
    await blocked.lease?.release({ discardIfIdle: true });
    await coordinator2.disconnectAll();
    connectSpy.mockRestore();
  });

  it('records permanent failure for needs-trust without retry', async () => {
    const root = path.resolve('trust-project');
    const d = {
      ...descriptor('trust-server'),
      scope: 'project' as const,
      command: 'node',
      blockedReason: 'Project MCP "trust-server" needs trust for projectRealpath+descriptorHash before connect.',
    };
    vi.spyOn(agentRuntimeConfigService, 'listMcpServers').mockReturnValue([d]);
    vi.spyOn(mcpTrustService, 'assertConnectAllowed').mockImplementation(() => {
      throw new Error(d.blockedReason!);
    });
    const coordinator = new McpConnectionCoordinator();
    const first = await coordinator.acquireConnections('ask', root, [d.id], 'trust-p');
    expect(first.errors[0]).toMatch(/needs trust/);
    const pool = (coordinator as unknown as {
      pools: Map<string, { failedMcpServers: Map<string, { kind: string; attempts: number }> }>;
    }).pools.get(first.lease!.poolKey)!;
    expect(pool.failedMcpServers.get(d.id)?.kind).toBe('permanent');

    const second = await coordinator.acquireConnections('ask', root, [d.id], 'trust-p');
    expect(second.errors[0]).toMatch(/needs trust/);
    expect(pool.failedMcpServers.get(d.id)?.attempts).toBe(1);

    await first.lease?.release({ discardIfIdle: true });
    await second.lease?.release({ discardIfIdle: true });
    await coordinator.disconnectAll();
  });
});

describe('McpConnectionCoordinator orphan quarantine', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('blocks re-acquire while quarantined and releases after supervised exit', async () => {
    vi.spyOn(runtimeLogService, 'log').mockReturnValue({} as never);
    const root = path.resolve('orphan-project');
    const d = { ...descriptor('orphan-server'), command: 'node' };
    vi.spyOn(agentRuntimeConfigService, 'listMcpServers').mockReturnValue([d]);

    let resolveExit!: (info: { reason: string }) => void;
    const exitPromise = new Promise<{ reason: string }>((resolve) => {
      resolveExit = resolve;
    });
    const supervised = {
      id: 'sup-1',
      exit: exitPromise,
    } as unknown as SupervisedProcess;

    const { MCPManager } = await import('../../agent-runtime/agent/MCPManager');
    vi.spyOn(MCPManager.prototype, 'connect').mockResolvedValue(['tool']);

    const coordinator2 = new McpConnectionCoordinator();
    const seed = await coordinator2.acquireConnections('ask', root, [d.id], 'orphan-p');
    expect(seed.errors).toEqual([]);
    const poolKey = seed.lease!.poolKey;
    const internals = coordinator2 as unknown as {
      pools: Map<string, {
        manager: { disconnectAll: () => Promise<McpDisconnectDetail[]>; listServers: () => string[] };
        quarantined: boolean;
        failedMcpServers: Map<string, unknown>;
      }>;
      orphanedPools: Map<string, unknown>;
    };
    const live = internals.pools.get(poolKey)!;
    live.failedMcpServers.clear();
    live.manager.listServers = () => [d.id];
    live.manager.disconnectAll = async () => ([{ serverName: d.id, status: 'orphaned' as const, supervised }]);

    await seed.lease?.release({ discardIfIdle: true });

    expect(internals.orphanedPools.has(poolKey)).toBe(true);
    expect(internals.pools.has(poolKey)).toBe(true);
    expect(live.quarantined).toBe(true);

    await expect(
      coordinator2.acquireConnections('ask', root, [d.id], 'orphan-p'),
    ).rejects.toThrow(/MCP_POOL_QUARANTINED/);

    resolveExit({ reason: 'exit' });
    await exitPromise;
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(internals.orphanedPools.has(poolKey)).toBe(false);
    expect(internals.pools.has(poolKey)).toBe(false);

    await expect(
      coordinator2.acquireConnections('ask', root, [d.id], 'orphan-p'),
    ).resolves.toBeTruthy();

    await coordinator2.disconnectAll();
  });
});