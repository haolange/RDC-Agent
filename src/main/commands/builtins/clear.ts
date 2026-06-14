/**
 * /clear — 清除当前会话历史。
 */
import type { CommandDefinition } from '@shared/types/command';

export const clearCommand: CommandDefinition = {
  id: 'clear',
  name: 'clear',
  description: 'Clear the current conversation history',
  aliases: ['cls'],
  category: 'system',

  async execute(_args, ctx) {
    return {
      success: true,
      message: 'Conversation cleared. Starting fresh.',
      sideEffect: `clear-session:${ctx.sessionId ?? 'current'}`,
    };
  },
};
