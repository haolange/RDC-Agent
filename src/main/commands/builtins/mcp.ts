/**
 * /mcp — the MCP servers configured for the current project and their live connection status.
 *
 * Connections are owned by the runtime: a turn acquires the project's pool when its agent needs MCP tools and the
 * pool reconnects on demand, so there is no manual connect or disconnect here; servers are managed in Settings.
 */
import { agentOrchestrator } from '../../agent-runtime/orchestration/agentRuntimeRoot';
import { projectWorkspaceStore } from '../../sessions/store/sessionStores';
import type { CommandDefinition } from '@shared/types/command';

export const mcpCommand: CommandDefinition = {
  id: 'mcp',
  name: 'mcp',
  description: 'Show MCP servers and their connection status',
  category: 'system',

  async execute(args, ctx) {
    const action = args[0] ?? 'list';
    if (action === 'settings') {
      return { success: true, message: 'Opening MCP settings.', uiAction: { type: 'open-settings', payload: { section: 'tools' } } };
    }
    if (action !== 'list') {
      return { success: false, message: 'Usage: /mcp [list | settings]. Servers connect when an agent turn needs them.' };
    }
    const projectRoot = ctx.projectId ? projectWorkspaceStore.getProjectById(ctx.projectId)?.rootPath ?? null : null;
    const servers = agentOrchestrator.getMcpServerStatusSummary(projectRoot);
    if (servers.length === 0) {
      return { success: true, message: 'No MCP servers are configured.', data: { servers } };
    }
    const lines = servers.map((server) => {
      const tools = server.connectionStatus === 'connected' ? ` · ${server.toolCount} tools` : '';
      const error = server.lastError ? ` · ${server.lastError}` : '';
      return `- ${server.name}: ${server.connectionStatus}${tools}${error}`;
    });
    return { success: true, message: `MCP servers:\n${lines.join('\n')}`, data: { servers } };
  },
};
