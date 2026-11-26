/**
 * /model — 查看或切换当前对话的模型。
 */
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

export const modelCommand: CommandDefinition = {
  id: 'model',
  name: 'model',
  descriptionKey: 'model.description',
  category: 'navigation',

  async execute(args, ctx) {
    if (args.length === 0) {
      const model = ctx.currentModelId ?? commandText('model.notConfigured');
      return { success: true, message: commandText('model.current', { model }) };
    }
    const token = args[0].trim();
    if (token.toLowerCase() === 'default') {
      return {
        success: true,
        message: commandText('model.default'),
        uiAction: { type: 'switch-model', payload: { modelId: 'default' } },
      };
    }
    return {
      success: true,
      message: commandText('model.switching', { model: token }),
      uiAction: { type: 'switch-model', payload: { modelId: token } },
    };
  },
};
