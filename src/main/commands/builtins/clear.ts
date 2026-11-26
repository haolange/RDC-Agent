/**
 * /clear — 清空当前对话历史。
 */
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

export const clearCommand: CommandDefinition = {
  id: 'clear',
  name: 'clear',
  descriptionKey: 'clear.description',
  aliases: ['cls'],
  category: 'system',

  async execute(_args, ctx) {
    const sessionId = ctx.sessionId ?? '';
    return {
      success: Boolean(sessionId),
      message: commandText(sessionId ? 'clear.running' : 'common.noSession'),
      uiAction: { type: 'clear-session', payload: { sessionId } },
    };
  },
};
