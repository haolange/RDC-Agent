import { describe, expect, it, vi } from 'vitest';

const status = vi.hoisted(() => ({ mode: 'auto-review' as const, servers: [] as unknown[] }));
vi.mock('../../runtime/RuntimePermissionStateService', () => ({
  runtimePermissionStateService: { getSnapshot: () => ({ mode: status.mode, revision: 3 }) },
}));
vi.mock('../../agent-runtime/orchestration/agentRuntimeRoot', () => ({
  agentOrchestrator: { getMcpServerStatusSummary: vi.fn((root: string | null) => (root === '/work/project' ? status.servers : [])) },
}));
vi.mock('../../sessions/store/sessionStores', () => ({
  projectWorkspaceStore: { getProjectById: (id: string) => (id === 'proj' ? { rootPath: '/work/project' } : null) },
}));

const { permissionsCommand } = await import('./permissions');
const { mcpCommand } = await import('./mcp');

describe('system commands report real state', () => {
  it('/permissions shows the mode the runtime enforces', async () => {
    const result = await permissionsCommand.execute([], {});
    expect(result).toMatchObject({ success: true, data: { mode: 'auto-review' } });
    expect(result.message).toContain('auto-review');
  });

  it('/mcp lists the current project servers with their live status and rejects manual connection', async () => {
    status.servers = [
      { id: 'docs', name: 'docs', connectionStatus: 'connected', toolCount: 2, tools: ['a', 'b'] },
      { id: 'tracker', name: 'tracker', connectionStatus: 'error', toolCount: 0, tools: [], lastError: 'spawn failed' },
    ];
    const listed = await mcpCommand.execute([], { projectId: 'proj' });
    expect(listed.message).toBe('MCP servers:\n- docs: connected · 2 tools\n- tracker: error · spawn failed');
    expect((await mcpCommand.execute([], {})).message).toBe('No MCP servers are configured.');
    expect(await mcpCommand.execute(['connect', 'docs'], { projectId: 'proj' })).toMatchObject({ success: false });
  });
});
