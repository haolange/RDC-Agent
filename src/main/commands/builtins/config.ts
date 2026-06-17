/**
 * /config — 打开设置或查看/修改配置项。
 */
import type { CommandDefinition } from '@shared/types/command';

export const configCommand: CommandDefinition = {
  id: 'config',
  name: 'config',
  description: 'Open settings or view/modify a configuration value',
  category: 'system',

  async execute(args) {
    return {
      success: true,
      message: 'Opening Settings...',
      uiAction: { type: 'open-settings', payload: args[0] ? { section: args[0] } : undefined },
    };
  },
};
