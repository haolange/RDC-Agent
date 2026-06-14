/**
 * /mcp — 管理 MCP 服务器连接。
 */
import type { CommandDefinition } from '@shared/types/command';

export const mcpCommand: CommandDefinition = {
  id: 'mcp',
  name: 'mcp',
  description: 'Manage MCP server connections (list, connect, disconnect)',
  category: 'system',

  async execute(args) {
    const action = args[0] ?? 'list';
    switch (action) {
      case 'list':
        return { success: true, message: 'Connected MCP servers: (list from MCPManager)' };
      case 'connect':
        return { success: true, message: `Connecting MCP server: ${args[1] ?? 'unnamed'}` };
      case 'disconnect':
        return { success: true, message: `Disconnected MCP server: ${args[1] ?? 'unnamed'}` };
      default:
        return { success: true, message: `MCP ${action} — use: list, connect <name>, disconnect <name>` };
    }
  },
};
