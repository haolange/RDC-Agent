/**
 * /tools — 列出或描述可用工具。
 */
import type { CommandDefinition } from '@shared/types/command';
import { BUILTIN_AGENT_TOOL_IDS } from '@shared/constants/agentToolTokens';

export const toolsCommand: CommandDefinition = {
  id: 'tools',
  name: 'tools',
  description: 'List available tools or get tool details',
  aliases: ['tool'],
  category: 'debug',

  async execute(args) {
    if (args.length > 0) {
      return {
        success: true,
        message: `Tool "${args[0]}": (details from ToolCatalog)`,
      };
    }
    return {
      success: true,
      message: `Available tools: ${BUILTIN_AGENT_TOOL_IDS.join(', ')}`,
    };
  },
};
