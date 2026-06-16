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
    if (args.length === 0) {
      return {
        success: true,
        message: 'Resuming latest interrupted session...',
        sideEffect: `resume-session:${ctx.sessionId ?? 'latest'}`,
      };
    }
    return {
      success: true,
      message: `Resuming session: ${args[0]}`,
      sideEffect: `resume-session:${args[0]}`,
    };
  },
};
