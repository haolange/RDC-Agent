/**
 * /undo — 撤销最后一条用户消息及其回复。
 */
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

export const undoCommand: CommandDefinition = {
  id: 'undo',
  name: 'undo',
  descriptionKey: 'undo.description',
  category: 'session',

  async execute(_args, ctx) {
    const sessionId = ctx.sessionId ?? '';
    return {
      success: Boolean(sessionId),
      message: commandText(sessionId ? 'undo.running' : 'common.noSession'),
      uiAction: { type: 'undo-session', payload: { sessionId } },
      invalidateStores: ['conversation'],
    };
  },
};
