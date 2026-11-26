/**
 * /session — 列出当前项目的对话；对话在侧边栏管理。
 */
import { sessionRecordStore } from '../../sessions/store/sessionStores';
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

export const sessionCommand: CommandDefinition = {
  id: 'session',
  name: 'session',
  descriptionKey: 'session.description',
  aliases: ['sess'],
  category: 'navigation',

  async execute(args, ctx) {
    if ((args[0] ?? 'list') !== 'list') return { success: false, message: commandText('session.sidebar') };
    if (!ctx.projectId) return { success: false, message: commandText('session.noProject') };
    const sessions = sessionRecordStore.listSessions(ctx.projectId);
    if (sessions.length === 0) return { success: true, message: commandText('session.none') };
    const lines = sessions.map(
      (session) =>
        `- ${session.title}${session.sessionId === ctx.sessionId ? ` (${commandText('session.current')})` : ''}`,
    );
    return { success: true, message: `${commandText('session.list')}\n${lines.join('\n')}` };
  },
};
