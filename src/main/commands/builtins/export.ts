/**
 * /export — 导出当前会话。
 */
import type { CommandDefinition } from '@shared/types/command';

export const exportCommand: CommandDefinition = {
  id: 'export',
  name: 'export',
  description: 'Export the current conversation to Markdown or JSON',
  category: 'workflow',

  async execute(args, ctx) {
    const format = args[0] ?? 'markdown';
    return {
      success: true,
      message: `Exporting session ${ctx.sessionId ?? 'current'} as ${format}...`,
      sideEffect: `export-session:${ctx.sessionId}:${format}`,
    };
  },
};
