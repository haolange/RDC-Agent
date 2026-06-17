import type { CommandDefinition } from '@shared/types/command';

export const exportCommand: CommandDefinition = {
  id: 'export',
  name: 'export',
  description: 'Export the current conversation to Markdown or JSON',
  category: 'workflow',

  async execute(args, ctx) {
    const sessionId = ctx.sessionId ?? '';
    const formatArg = args[0] ?? 'markdown';
    const format = formatArg === 'json' ? 'json' : 'markdown';
    return {
      success: Boolean(sessionId),
      message: sessionId
        ? `Exporting session ${sessionId} as ${format}...`
        : 'No active session. Open or create a session before exporting history.',
      uiAction: { type: 'export-session', payload: { sessionId, format } },
    };
  },
};
