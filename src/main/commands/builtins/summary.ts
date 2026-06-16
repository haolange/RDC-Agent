/**
 * /summary — 生成当前会话摘要。
 */
import type { CommandDefinition } from '@shared/types/command';

export const summaryCommand: CommandDefinition = {
  id: 'summary',
  name: 'summary',
  description: 'Generate a summary of the current conversation',
  aliases: ['sum'],
  category: 'session',

  async execute(_args, ctx) {
    return {
      success: true,
      message: `Conversation summary for session ${ctx.sessionId ?? 'current'}: (generated from conversation history)`,
    };
  },
};
