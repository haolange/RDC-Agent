/**
 * /permissions — 查看或切换权限模式。
 */
import type { CommandDefinition } from '@shared/types/command';

export const permissionsCommand: CommandDefinition = {
  id: 'permissions',
  name: 'permissions',
  description: 'View or change the current permission mode',
  aliases: ['perm'],
  category: 'system',

  async execute(args, ctx) {
    if (args.length === 0) {
      return {
        success: true,
        message: `Current permission mode: default\n  Agent: ${ctx.agentId ?? 'none'}`,
      };
    }
    const mode = args[0];
    return {
      success: true,
      message: `Switched permission mode to: ${mode}`,
      sideEffect: `switch-permissions:${mode}`,
    };
  },
};
