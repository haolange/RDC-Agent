/**
 * /workspace — 查看或修改工作区路径。
 */
import type { CommandDefinition } from '@shared/types/command';

export const workspaceCommand: CommandDefinition = {
  id: 'workspace',
  name: 'workspace',
  description: 'View or change the workspace root directory',
  aliases: ['ws', 'cd'],
  category: 'navigation',

  async execute(args, ctx) {
    if (args.length === 0) {
      return {
        success: true,
        message: `Current workspace: ${ctx.workspaceRoot ?? 'not set'}`,
      };
    }
    return {
      success: true,
      message: `Workspace changed to: ${args[0]}`,
      sideEffect: `change-workspace:${args[0]}`,
    };
  },
};
