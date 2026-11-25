import type { CommandDefinition } from '../CommandRegistry';

export const clearCommand: CommandDefinition = {
  id: 'clear',
  name: 'clear',
  description: 'Clear the current conversation history',
  aliases: ['cls'],
  category: 'system',

  async execute(_args, ctx) {
    const sessionId = ctx.sessionId ?? '';
    return {
      success: Boolean(sessionId),
      message: sessionId
        ? 'Clearing conversation history...'
        : 'No active session. Open or create a session before clearing history.',
      uiAction: { type: 'clear-session', payload: { sessionId } },
    };
  },
};
