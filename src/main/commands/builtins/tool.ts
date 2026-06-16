/**
 * /tool — 列出或管理可用工具。
 */
import type { CommandDefinition } from '@shared/types/command';

export const toolCommand: CommandDefinition = {
  id: 'tool',
  name: 'tool',
  description: 'List available tools or get tool details',
  aliases: ['tools'],
  category: 'debug',

  async execute(args) {
    if (args.length > 0) {
      return {
        success: true,
        message: `Tool "${args[0]}": (tool details from ToolCatalog)`,
      };
    }
    return {
      success: true,
      message: 'Available tools: bash, read_file, write_file, edit_file, glob, grep, web_fetch, web_search, agent, task, mcp, skill, ask_user (detailed list from ToolCatalog)',
    };
  },
};
