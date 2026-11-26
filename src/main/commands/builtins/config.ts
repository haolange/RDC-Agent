/**
 * /config — 打开设置。
 */
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

export const configCommand: CommandDefinition = {
  id: 'config',
  name: 'config',
  descriptionKey: 'config.description',
  category: 'system',

  async execute(args) {
    return {
      success: true,
      message: commandText('config.opening'),
      uiAction: { type: 'open-settings', payload: args[0] ? { section: args[0] } : undefined },
    };
  },
};
