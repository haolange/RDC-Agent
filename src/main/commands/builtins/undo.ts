import type { CommandDefinition } from '@shared/types/command';

export const undoCommand: CommandDefinition = {
  id: 'undo',
  name: 'undo',
  description: 'Undo the last user message and its assistant response',
  category: 'session',

  async execute(_args, ctx) {
    const sessionId = ctx.sessionId ?? '';
    return {
      success: Boolean(sessionId),
      message: sessionId
        ? 'Undoing last conversation turn...'
        : 'No active session. Open or create a session before undoing history.',
      uiAction: { type: 'undo-session', payload: { sessionId } },
      invalidateStores: ['conversation'],
    };
  },
};
