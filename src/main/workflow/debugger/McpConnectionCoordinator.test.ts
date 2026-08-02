import { afterEach, describe, expect, it, vi } from 'vitest';
import path from 'path';
import { McpConnectionCoordinator } from './McpConnectionCoordinator';
import { agentRuntimeConfigService } from '../../settings/AgentRuntimeConfigService';

describe('McpConnectionCoordinator project ownership', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('evicts a project pool only after every turn lease is released', async () => {
    const root = path.resolve('shared-project');
    const descriptor = {
      id: 'shared-server', name: 'Shared', description: '', transport: 'stdio' as const, scope: 'user' as const,
      sourcePath: 'shared', sourceHash: 'shared', enabledByDefault: true,
    };
    vi.spyOn(agentRuntimeConfigService, 'listMcpServers').mockReturnValue([descriptor]);
    const coordinator = new McpConnectionCoordinator();
    const first = await coordinator.acquireConnections('ask', root, [descriptor.id]);
    const second = await coordinator.acquireConnections('ask', root, [descriptor.id]);
    expect(coordinator.getRuntimeStatusSummary(root)[0]?.connectionStatus).toBe('error');
    await first.lease?.release({ discardIfIdle: true });
    expect(coordinator.getRuntimeStatusSummary(root)[0]?.connectionStatus).toBe('error');
    await second.lease?.release({ discardIfIdle: true });
    expect(coordinator.getRuntimeStatusSummary(root)).toEqual([]);
    await coordinator.disconnectAll();
  });

  it('keeps a turn bound to its leased pool when descriptors change', async () => {
    const root = path.resolve('descriptor-changing-project');
    const descriptorA = {
      id: 'descriptor-a',
      name: 'Descriptor A',
      description: '',
      transport: 'stdio' as const,
      scope: 'user' as const,
      sourcePath: 'a',
      sourceHash: 'a',
      enabledByDefault: true,
    };
    const descriptorB = {
      ...descriptorA,
      id: 'descriptor-b',
      name: 'Descriptor B',
      sourcePath: 'b',
      sourceHash: 'b',
    };
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
    const descriptorA = {
      id: 'project-a-server',
      name: 'Project A',
      description: '',
      transport: 'stdio' as const,
      scope: 'user' as const,
      sourcePath: 'user-a',
      sourceHash: 'a',
      enabledByDefault: true,
    };
    const descriptorB = {
      id: 'project-b-server',
      name: 'Project B',
      description: '',
      transport: 'stdio' as const,
      scope: 'user' as const,
      sourcePath: 'user-b',
      sourceHash: 'b',
      enabledByDefault: true,
    };
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

    // Starting B must not disconnect A or replace its tool/status surface.
    expect(coordinator.getRuntimeStatusSummary(rootA)[0]?.id).toBe(descriptorA.id);
    expect(coordinator.getRuntimeStatusSummary(rootA)[0]?.connectionStatus).toBe('error');

    await leaseA.lease?.release({ discardIfIdle: true });
    await leaseB.lease?.release({ discardIfIdle: true });
    await coordinator.disconnectAll();
  });
});
