/**
 * /plan — 进入或退出计划模式。
 */
import type { CommandDefinition } from '@shared/types/command';

export const planCommand: CommandDefinition = {
  id: 'plan',
  name: 'plan',
  description: 'Enter or exit plan mode for structured implementation planning',
  category: 'workflow',

  async execute(args) {
    const action = args[0];
    if (action === 'exit' || action === 'done') {
      return {
        success: true,
        message: 'Exited plan mode. Ready to implement.',
        sideEffect: 'exit-plan-mode',
      };
    }
    return {
      success: true,
      message: 'Entered plan mode. Describe your task and I\'ll design an implementation plan.',
      sideEffect: 'enter-plan-mode',
    };
  },
};
