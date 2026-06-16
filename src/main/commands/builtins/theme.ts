/**
 * /theme — 切换应用主题。
 */
import type { CommandDefinition } from '@shared/types/command';

export const themeCommand: CommandDefinition = {
  id: 'theme',
  name: 'theme',
  description: 'Switch application theme (dark/light)',
  category: 'system',

  async execute(args, ctx) {
    if (args.length === 0) {
      return {
        success: true,
        message: `Current theme: ${ctx.currentTheme ?? 'system'}`,
      };
    }
    const theme = args[0];
    return {
      success: true,
      message: `Switched theme to: ${theme}`,
      sideEffect: `switch-theme:${theme}`,
      uiAction: { type: 'switch-theme', payload: { theme } },
    };
  },
};
