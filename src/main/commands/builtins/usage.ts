/**
 * /usage — 显示 API 调用统计。
 */
import type { CommandDefinition } from '@shared/types/command';

export const usageCommand: CommandDefinition = {
  id: 'usage',
  name: 'usage',
  description: 'Show API call statistics and usage summary',
  category: 'debug',

  async execute(_args, ctx) {
    return {
      success: true,
      message: `Usage statistics for session ${ctx.sessionId ?? 'current'}:\n  API calls: 0\n  Total tokens: 0\n  Tools used: 0`,
    };
  },
};
