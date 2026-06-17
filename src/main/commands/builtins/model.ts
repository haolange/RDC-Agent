import type { CommandDefinition } from '@shared/types/command';

export const modelCommand: CommandDefinition = {
  id: 'model',
  name: 'model',
  description: 'View or switch the current LLM model',
  category: 'navigation',

  async execute(args, ctx) {
    if (args.length === 0) {
      return {
        success: true,
        message: `Current model: ${ctx.currentModelId ?? 'not configured'}`,
      };
    }
    return {
      success: true,
      message: `Switching model to: ${args[0]}`,
      uiAction: { type: 'switch-model', payload: { modelId: args[0] } },
    };
  },
};
