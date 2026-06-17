import type { CommandDefinition } from '@shared/types/command';

const PERMISSION_MODES = new Set(['default', 'auto-review', 'full-access', 'custom']);

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
        message: `Current permission mode: default\nAgent: ${ctx.agentId ?? 'none'}`,
      };
    }
    const mode = args[0];
    if (!PERMISSION_MODES.has(mode)) {
      return {
        success: false,
        message: 'Permission mode must be default, auto-review, full-access, or custom.',
      };
    }
    return {
      success: true,
      message: `Switching permission mode to: ${mode}`,
      uiAction: { type: 'switch-permissions', payload: { mode } },
    };
  },
};
