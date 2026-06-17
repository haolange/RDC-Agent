import type { CommandDefinition } from '@shared/types/command';

const THEMES = new Set(['dark', 'light', 'system']);

export const themeCommand: CommandDefinition = {
  id: 'theme',
  name: 'theme',
  description: 'Switch application theme (dark/light/system)',
  category: 'system',

  async execute(args, ctx) {
    if (args.length === 0) {
      return {
        success: true,
        message: `Current theme: ${ctx.currentTheme ?? 'system'}`,
      };
    }
    const theme = args[0];
    if (!THEMES.has(theme)) {
      return {
        success: false,
        message: 'Theme must be dark, light, or system.',
      };
    }
    return {
      success: true,
      message: `Switching theme to: ${theme}`,
      uiAction: { type: 'switch-theme', payload: { theme } },
    };
  },
};
