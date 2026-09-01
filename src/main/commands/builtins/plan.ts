/**
 * /plan — 不再硬切 builtin plan。
 * 提示选择 Mission 或生成 plan artifact；用户 custom `plan` 仍可用 `/agents plan`。
 */
import type { CommandDefinition } from '@shared/types/command';

export const planCommand: CommandDefinition = {
  id: 'plan',
  name: 'plan',
  description: 'Prompt to choose a Mission profile or write a plan artifact',
  category: 'workflow',

  async execute() {
    return {
      success: true,
      message: [
        'There is no builtin Plan profile.',
        'Choose Debugger, Analyzer, or Optimizer for a Mission, or ask General to write a plan artifact.',
        'If you keep a custom `plan` profile, switch with `/agents plan`.',
      ].join(' '),
    };
  },
};
