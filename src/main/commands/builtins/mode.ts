/**
 * /mode — 切换 Agent 模式。
 */
import type { CommandDefinition } from '@shared/types/command';

const VALID_MODES = ['ask', 'plan', 'edit', 'debugger', 'analyzer', 'optimizer'];

export const modeCommand: CommandDefinition = {
  id: 'mode',
  name: 'mode',
  description: 'Switch agent mode (ask, plan, edit, debugger, analyzer, optimizer)',
  category: 'navigation',

  async execute(args) {
    if (args.length === 0) {
      return {
        success: true,
        message: `Available modes: ${VALID_MODES.join(', ')}`,
      };
    }
    const target = args[0].toLowerCase();
    if (!VALID_MODES.includes(target)) {
      return {
        success: false,
        message: `Invalid mode: "${target}". Valid modes: ${VALID_MODES.join(', ')}`,
      };
    }
    return {
      success: true,
      message: `Switched to ${target} mode.`,
      sideEffect: `switch-mode:${target}`,
    };
  },
};
