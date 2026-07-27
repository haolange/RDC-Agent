/**
 * /tools — 列出或描述可用工具。
 */
import type { CommandDefinition } from '@shared/types/command';

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
      message: 'Available tools: bash, read_file, write_file, edit_file, delete_file, move_file, copy_file, glob, grep, git_status, git_diff, git_log, git_add, git_unstage, git_commit, web_fetch, web_search, ask_user, notebook_edit, task_create, task_update, task_get, task_list, task_stop, output_register, tool_search, skill_read, skills, subagent, mcp, rdx_context',
    };
  },
};
