/**
 * /tools — 列出内置工具。
 */
import { BUILTIN_AGENT_TOOL_IDS } from '@shared/constants/agentToolTokens';
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

export const toolsCommand: CommandDefinition = {
  id: 'tools',
  name: 'tools',
  descriptionKey: 'tools.description',
  aliases: ['tool'],
  category: 'debug',

  async execute(args) {
    if (args.length > 0) {
      const known = (BUILTIN_AGENT_TOOL_IDS as readonly string[]).includes(args[0]);
      return { success: known, message: commandText(known ? 'tools.known' : 'tools.unknown', { tool: args[0] }) };
    }
    return { success: true, message: commandText('tools.list', { tools: BUILTIN_AGENT_TOOL_IDS.join(', ') }) };
  },
};
