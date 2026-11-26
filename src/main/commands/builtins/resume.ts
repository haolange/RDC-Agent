/**
 * /resume — 继续一个被中断的对话。
 */
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

export const resumeCommand: CommandDefinition = {
  id: 'resume',
  name: 'resume',
  descriptionKey: 'resume.description',
  aliases: ['res'],
  category: 'session',

  async execute(args, ctx) {
    const sessionId = args[0] ?? ctx.sessionId ?? '';
    return {
      success: true,
      message: args.length === 0 ? commandText('resume.latest') : commandText('resume.session', { sessionId: args[0] }),
      uiAction: { type: 'resume-session', payload: { sessionId } },
    };
  },
};
