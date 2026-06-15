/**
 * /compact — 请求上下文压缩。
 */
import type { CommandDefinition } from '@shared/types/command';

export const compactCommand: CommandDefinition = {
  id: 'compact',
  name: 'compact',
  description: 'Compact the conversation context to fit within token budget',
  category: 'session',

  async execute(_args, ctx) {
    return {
      success: true,
      message: 'Compacting conversation context...',
      sideEffect: `compact-session:${ctx.sessionId ?? 'current'}`,
    };
  },
};
