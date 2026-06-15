/**
 * /undo — 回退上一条用户消息。
 */
import type { CommandDefinition } from '@shared/types/command';

export const undoCommand: CommandDefinition = {
  id: 'undo',
  name: 'undo',
  description: 'Undo the last user message and its assistant response',
  category: 'session',

  async execute(_args, ctx) {
    return {
      success: true,
      message: 'Undoing last message...',
      sideEffect: `undo-session:${ctx.sessionId ?? 'current'}`,
      invalidateStores: ['conversation'],
    };
  },
};
