import { beforeEach, describe, expect, it, vi } from 'vitest';

const status = vi.hoisted(() => ({
  mode: 'auto-review' as const,
  servers: [] as unknown[],
  language: 'en' as 'en' | 'zh-CN',
  trusted: false,
  confirm: true,
}));
const mcp = vi.hoisted(() => ({ connectServer: vi.fn(), disconnectServer: vi.fn(), trust: vi.fn() }));
vi.mock('../../runtime/RuntimePermissionStateService', () => ({
  runtimePermissionStateService: { getSnapshot: () => ({ mode: status.mode, revision: 3 }) },
}));
vi.mock('../../agent-runtime/orchestration/agentRuntimeRoot', () => ({
  agentOrchestrator: {
    getMcpServerStatusSummary: vi.fn((root: string | null) => (root === '/work/project' ? status.servers : [])),
    mcpConnections: { connectServer: mcp.connectServer, disconnectServer: mcp.disconnectServer },
  },
}));
vi.mock('../../sessions/store/sessionStores', () => ({
  projectWorkspaceStore: { getProjectById: (id: string) => (id === 'proj' ? { rootPath: '/work/project' } : null) },
}));
vi.mock('../../settings/agent-manifests/AgentRuntimeConfigService', () => ({
  agentRuntimeConfigService: {
    listMcpServers: () => [{ id: 'docs', name: 'docs', scope: 'project', transport: 'stdio', command: 'docs-mcp' }],
  },
}));
vi.mock('../../settings/agent-manifests/ScopedRuntimeService', () => ({
  scopedRuntimeService: { trustProjectMcp: mcp.trust },
}));
vi.mock('../../settings/settings-core/McpTrustService', () => ({
  mcpTrustService: { isTrusted: () => status.trusted },
}));
vi.mock('../../window/trustConfirmation', () => ({ confirmMcpTrust: vi.fn(async () => status.confirm) }));
vi.mock('../commandI18n', async () => {
  const { commandTextFor } = await import('../commandMessages');
  return {
    commandText: (key: never, params?: Record<string, string | number>) => commandTextFor(status.language, key, params),
  };
});

const { permissionsCommand } = await import('./permissions');
const { mcpCommand } = await import('./mcp');
const ctx = { projectId: 'proj' };

beforeEach(() => {
  status.language = 'en';
  status.trusted = false;
  status.confirm = true;
  mcp.connectServer.mockReset();
  mcp.disconnectServer.mockReset();
  mcp.trust.mockReset();
});

describe('system commands report real state', () => {
  it('/permissions shows the mode the runtime enforces, in the app language', async () => {
    const result = await permissionsCommand.execute([], {});
    expect(result).toMatchObject({ success: true, message: 'Current permission mode: auto-review' });
    status.language = 'zh-CN';
    expect((await permissionsCommand.execute([], {})).message).toBe('当前权限模式：auto-review');
  });

  it('/mcp lists the current project servers with their live status', async () => {
    status.servers = [
      { id: 'docs', name: 'docs', connectionStatus: 'connected', toolCount: 2, tools: ['a', 'b'] },
      { id: 'tracker', name: 'tracker', connectionStatus: 'error', toolCount: 0, tools: [], lastError: 'spawn failed' },
    ];
    const listed = await mcpCommand.execute([], ctx);
    expect(listed.message).toBe('MCP servers:\n- docs: connected · 2 tools\n- tracker: error · spawn failed');
    expect((await mcpCommand.execute([], {})).message).toBe('No MCP servers are configured.');
  });

  it('/mcp connect asks trust for an untrusted project server and does not connect when it is declined', async () => {
    status.confirm = false;
    expect(await mcpCommand.execute(['connect', 'docs'], ctx)).toEqual({
      success: false,
      message: '"docs" was not trusted, so it was not connected.',
    });
    expect(mcp.trust).not.toHaveBeenCalled();
    expect(mcp.connectServer).not.toHaveBeenCalled();
  });

  it('/mcp connect trusts on confirmation, connects through the coordinator and reports its failure truthfully', async () => {
    mcp.connectServer.mockResolvedValueOnce({ alreadyConnected: false, status: { id: 'docs', toolCount: 2 } });
    expect(await mcpCommand.execute(['connect', 'docs'], ctx)).toMatchObject({
      success: true,
      message: 'Connected "docs" · 2 tools.',
    });
    expect(mcp.trust).toHaveBeenCalledWith('/work/project', 'docs');
    expect(mcp.connectServer).toHaveBeenCalledWith('/work/project', 'proj', expect.objectContaining({ id: 'docs' }));

    status.trusted = true;
    status.language = 'zh-CN';
    mcp.connectServer.mockRejectedValueOnce(new Error('spawn docs-mcp ENOENT'));
    expect(await mcpCommand.execute(['connect', 'docs'], ctx)).toEqual({
      success: false,
      message: '无法连接「docs」：spawn docs-mcp ENOENT',
    });
    expect(await mcpCommand.execute(['connect', 'nope'], ctx)).toMatchObject({ success: false });
  });

  it('/mcp disconnect leaves a server a running turn holds and says so', async () => {
    mcp.disconnectServer.mockResolvedValueOnce('in-use').mockResolvedValueOnce('disconnected');
    expect(await mcpCommand.execute(['disconnect', 'docs'], ctx)).toEqual({
      success: false,
      message: '"docs" is in use by a running turn. Stop the turn first.',
    });
    expect(await mcpCommand.execute(['disconnect', 'docs'], ctx)).toMatchObject({ success: true });
    expect(mcp.disconnectServer).toHaveBeenLastCalledWith('/work/project', 'proj', 'docs');
    expect((await mcpCommand.execute(['disconnect'], ctx)).message).toContain('Usage: /mcp');
  });
});
