import type { CommandDefinition } from '@shared/types/command';

export const modelCommand: CommandDefinition = {
  id: 'model',
  name: 'model',
  description: 'View or switch the current conversation model; use default to follow the Agent configuration',
  category: 'navigation',

  async execute(args, ctx) {
    if (args.length === 0) {
      return {
        success: true,
        message: `Current model: ${ctx.currentModelId ?? 'not configured'}`,
      };
    }
    const token = args[0].trim();
    if (token.toLowerCase() === 'default') {
      return {
        success: true,
        message: 'Following the current Agent configuration',
        uiAction: { type: 'switch-model', payload: { modelId: 'default' } },
      };
    }
    return {
      success: true,
      message: `Switching model to: ${token}`,
      uiAction: { type: 'switch-model', payload: { modelId: token } },
    };
  },
};
