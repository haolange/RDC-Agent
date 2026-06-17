/**
 * /resume — 恢复可恢复会话。
 */
import type { CommandDefinition } from '@shared/types/command';

export const resumeCommand: CommandDefinition = {
  id: 'resume',
  name: 'resume',
  description: 'Resume a previously interrupted session',
  aliases: ['res'],
  category: 'session',

  async execute(args, ctx) {
    const sessionId = args[0] ?? ctx.sessionId ?? '';
    return {
      success: true,
      message: args.length === 0 ? 'Resuming latest interrupted session...' : `Resuming session: ${args[0]}`,
      uiAction: { type: 'resume-session', payload: { sessionId } },
    };
  },
};
