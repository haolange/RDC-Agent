import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

const THEMES = new Set(['dark', 'light', 'system']);

export const themeCommand: CommandDefinition = {
  id: 'theme',
  name: 'theme',
  descriptionKey: 'theme.description',
  category: 'system',

  async execute(args, ctx) {
    if (args.length === 0) {
      return { success: true, message: commandText('theme.current', { theme: ctx.currentTheme ?? 'system' }) };
    }
    const theme = args[0];
    if (!THEMES.has(theme)) return { success: false, message: commandText('theme.invalid') };
    return {
      success: true,
      message: commandText('theme.switching', { theme }),
      uiAction: { type: 'switch-theme', payload: { theme } },
    };
  },
};
