/**
 * /plan — 切换到 Plan agent profile。
 *
 * Plan 不是独立 AppMode，而是可调用的 agent profile（research/ask/plan artifact/handoff）。
 * 该命令等价于 `/agents plan`，仅作意图快捷入口。
 */
import type { CommandDefinition } from '@shared/types/command';

export const planCommand: CommandDefinition = {
  id: 'plan',
  name: 'plan',
  description: 'Switch to the Plan profile to research and design an implementation plan before editing',
  category: 'workflow',

  async execute() {
    return {
      success: true,
      message: 'Switched to the Plan profile. Describe your task and I will research, ask questions, and write a plan before handing off to implementation.',
      uiAction: { type: 'switch-mode', payload: { agentId: 'plan' } },
    };
  },
};
