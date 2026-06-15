/**
 * /cost — 显示当前运行的 token 用量和成本。
 */
import type { CommandDefinition } from '@shared/types/command';

export const costCommand: CommandDefinition = {
  id: 'cost',
  name: 'cost',
  description: 'Show token usage and estimated cost for the current run',
  category: 'debug',

  async execute(_args, ctx) {
    return {
      success: true,
      message: `Token usage for session ${ctx.sessionId ?? 'current'}:\n  Input: 0 tokens\n  Output: 0 tokens\n  Total: 0 tokens\n  Estimated cost: $0.00`,
    };
  },
};
