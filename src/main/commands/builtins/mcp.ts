/**
 * /mcp — the MCP servers configured for the current project, their live connection status, and a manual connect or
 * disconnect of one server through the same connection coordinator turns use. A project server that is not trusted
 * goes through the trust dialog first; declining leaves it unconnected.
 */
import { agentOrchestrator } from '../../agent-runtime/orchestration/agentRuntimeRoot';
import { projectWorkspaceStore } from '../../sessions/store/sessionStores';
import { agentRuntimeConfigService } from '../../settings/agent-manifests/AgentRuntimeConfigService';
import { scopedRuntimeService } from '../../settings/agent-manifests/ScopedRuntimeService';
import { mcpTrustService } from '../../settings/settings-core/McpTrustService';
import { confirmMcpTrust } from '../../window/trustConfirmation';
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';
import type { CommandContext, CommandResult } from '@shared/types/command';
import type { MCPServerStatusSummary } from '@shared/types/mcp';

const projectRootOf = (ctx: CommandContext): string | null =>
  ctx.projectId ? (projectWorkspaceStore.getProjectById(ctx.projectId)?.rootPath ?? null) : null;

function listServers(ctx: CommandContext): CommandResult {
  const servers = agentOrchestrator.getMcpServerStatusSummary(projectRootOf(ctx));
  if (servers.length === 0) return { success: true, message: commandText('mcp.none'), data: { servers } };
  const lines = servers.map((server: MCPServerStatusSummary) => {
    const tools =
      server.connectionStatus === 'connected' ? ` · ${commandText('mcp.tools', { count: server.toolCount })}` : '';
    const error = server.lastError ? ` · ${server.lastError}` : '';
    return `- ${server.name}: ${commandText(`mcp.status.${server.connectionStatus}`)}${tools}${error}`;
  });
  return { success: true, message: `${commandText('mcp.title')}\n${lines.join('\n')}`, data: { servers } };
}

async function connectServer(name: string, ctx: CommandContext): Promise<CommandResult> {
  const projectRoot = projectRootOf(ctx);
  const server = agentRuntimeConfigService
    .listMcpServers(projectRoot ?? undefined)
    .find((entry) => entry.id === name || entry.name === name);
  if (!server) return { success: false, message: commandText('mcp.unknownServer', { server: name }) };
  if (server.scope === 'project' && projectRoot && !mcpTrustService.isTrusted(projectRoot, server)) {
    if (!(await confirmMcpTrust(server))) {
      return { success: false, message: commandText('mcp.trustDeclined', { server: server.name }) };
    }
    scopedRuntimeService.trustProjectMcp(projectRoot, server.id);
  }
  try {
    const { alreadyConnected, status } = await agentOrchestrator.mcpConnections.connectServer(
      projectRoot,
      ctx.projectId ?? null,
      server,
    );
    return {
      success: true,
      message: commandText(alreadyConnected ? 'mcp.alreadyConnected' : 'mcp.connected', {
        server: server.name,
        count: status.toolCount,
      }),
      data: { server: status },
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { success: false, message: commandText('mcp.connectFailed', { server: server.name, reason }) };
  }
}

async function disconnectServer(name: string, ctx: CommandContext): Promise<CommandResult> {
  const projectRoot = projectRootOf(ctx);
  const server = agentRuntimeConfigService
    .listMcpServers(projectRoot ?? undefined)
    .find((entry) => entry.id === name || entry.name === name);
  if (!server) return { success: false, message: commandText('mcp.unknownServer', { server: name }) };
  const outcome = await agentOrchestrator.mcpConnections.disconnectServer(
    projectRoot,
    ctx.projectId ?? null,
    server.id,
  );
  const message = {
    disconnected: 'mcp.disconnected',
    'not-connected': 'mcp.notConnected',
    'in-use': 'mcp.inUse',
    orphaned: 'mcp.orphaned',
  } as const;
  return { success: outcome === 'disconnected', message: commandText(message[outcome], { server: server.name }) };
}

export const mcpCommand: CommandDefinition = {
  id: 'mcp',
  name: 'mcp',
  descriptionKey: 'mcp.description',
  category: 'system',

  async execute(args, ctx) {
    const [action = 'list', name] = args;
    if (action === 'list') return listServers(ctx);
    if (action === 'settings') {
      return {
        success: true,
        message: commandText('mcp.opening'),
        uiAction: { type: 'open-settings', payload: { section: 'tools' } },
      };
    }
    if (action === 'connect' && name) return connectServer(name, ctx);
    if (action === 'disconnect' && name) return disconnectServer(name, ctx);
    return { success: false, message: commandText('mcp.usage') };
  },
};
