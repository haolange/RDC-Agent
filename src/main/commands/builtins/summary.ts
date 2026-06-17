import type { CommandDefinition } from '@shared/types/command';

export const summaryCommand: CommandDefinition = {
  id: 'summary',
  name: 'summary',
  description: 'Summarize and compact the current conversation history',
  aliases: ['sum'],
  category: 'session',

  async execute(_args, ctx) {
    const sessionId = ctx.sessionId ?? '';
    return {
      success: Boolean(sessionId),
      message: sessionId
        ? 'Summarizing conversation history...'
        : 'No active session. Open or create a session before summarizing.',
      uiAction: { type: 'compact-session', payload: { sessionId } },
    };
  },
};
