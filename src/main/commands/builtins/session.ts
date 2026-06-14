/**
 * /session — 会话管理命令。
 */
import type { CommandDefinition } from '@shared/types/command';

export const sessionCommand: CommandDefinition = {
  id: 'session',
  name: 'session',
  description: 'Manage sessions (list, create, rename, delete, resume)',
  aliases: ['sess'],
  category: 'navigation',

  async execute(args, ctx) {
    const action = args[0] ?? 'list';
    switch (action) {
      case 'list':
        return { success: true, message: 'Sessions: (list from SessionStore)' };
      case 'new':
        return { success: true, message: 'Creating new session...' };
      case 'rename':
        return { success: true, message: `Renamed session to: ${args[1] ?? 'untitled'}` };
      case 'resume':
        return { success: true, message: `Resuming session: ${args[1] ?? ctx.sessionId}` };
      default:
        return { success: true, message: `Session ${action}: current = ${ctx.sessionId ?? 'none'}` };
    }
  },
};
