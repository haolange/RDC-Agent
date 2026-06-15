/**
 * /agents — 列出或切换可用 Agent profiles。
 */
import type { CommandDefinition } from '@shared/types/command';

export const agentsCommand: CommandDefinition = {
  id: 'agents',
  name: 'agents',
  description: 'List available agent profiles or switch to a specific agent',
  aliases: ['agent'],
  category: 'workflow',

  async execute(args) {
    if (args.length === 0) {
      return {
        success: true,
        message: 'Available agents: ask, plan, edit, debugger, analyzer, optimizer (from AgentManifestService)',
      };
    }
    const target = args[0];
    return {
      success: true,
      message: `Switched to agent: ${target}`,
      sideEffect: `switch-mode:${target}`,
      uiAction: { type: 'switch-mode', payload: { agentId: target } },
    };
  },
};
