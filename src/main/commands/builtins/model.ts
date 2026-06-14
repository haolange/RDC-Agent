/**
 * /model — 查看或切换 LLM 模型。
 */
import type { CommandDefinition } from '@shared/types/command';

export const modelCommand: CommandDefinition = {
  id: 'model',
  name: 'model',
  description: 'View or switch the current LLM model',
  category: 'navigation',

  async execute(args) {
    if (args.length === 0) {
      return {
        success: true,
        message: 'Current model: (use /model <name> to switch)',
      };
    }
    return {
      success: true,
      message: `Switched model to: ${args[0]}`,
      sideEffect: `switch-model:${args[0]}`,
    };
  },
};
