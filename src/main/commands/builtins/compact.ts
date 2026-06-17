import type { CommandDefinition } from '@shared/types/command';

export const compactCommand: CommandDefinition = {
  id: 'compact',
  name: 'compact',
  description: 'Compact the conversation context to fit within token budget',
  category: 'session',

  async execute(_args, ctx) {
    const sessionId = ctx.sessionId ?? '';
    return {
      success: Boolean(sessionId),
      message: sessionId
        ? 'Compacting conversation context...'
        : 'No active session. Open or create a session before compacting history.',
      uiAction: { type: 'compact-session', payload: { sessionId } },
    };
  },
};
