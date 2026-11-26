/**
 * /export — 将当前对话导出为 Markdown 或 JSON。
 */
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

export const exportCommand: CommandDefinition = {
  id: 'export',
  name: 'export',
  descriptionKey: 'export.description',
  category: 'workflow',

  async execute(args, ctx) {
    const sessionId = ctx.sessionId ?? '';
    const format = args[0] === 'json' ? 'json' : 'markdown';
    return {
      success: Boolean(sessionId),
      message: sessionId ? commandText('export.running', { format }) : commandText('common.noSession'),
      uiAction: { type: 'export-session', payload: { sessionId, format } },
    };
  },
};
