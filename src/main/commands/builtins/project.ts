/**
 * /project — 项目管理命令。
 */
import type { CommandDefinition } from '@shared/types/command';

export const projectCommand: CommandDefinition = {
  id: 'project',
  name: 'project',
  description: 'Manage projects (list, create, switch, rename, delete)',
  aliases: ['prj'],
  category: 'navigation',

  async execute(args, ctx) {
    const action = args[0] ?? 'list';
    switch (action) {
      case 'list':
        return { success: true, message: 'Projects: (list from ProjectStore)' };
      case 'create':
        return { success: true, message: `Creating project: ${args[1] ?? 'unnamed'}` };
      case 'switch':
        return { success: true, message: `Switched to project: ${args[1] ?? ctx.projectId}` };
      default:
        return { success: true, message: `Project ${action}: current = ${ctx.projectId ?? 'none'}` };
    }
  },
};
