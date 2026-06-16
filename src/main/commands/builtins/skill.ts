/**
 * /skill — 列出或执行技能。
 */
import type { CommandDefinition } from '@shared/types/command';

export const skillCommand: CommandDefinition = {
  id: 'skill',
  name: 'skill',
  description: 'List available skills or run a specific skill',
  aliases: ['skills'],
  category: 'workflow',

  async execute(args) {
    if (args.length === 0) {
      return {
        success: true,
        message: 'Available skills: (list from SkillLoader)',
      };
    }
    const action = args[0];
    if (action === 'run') {
      return {
        success: true,
        message: `Running skill: ${args[1] ?? 'unnamed'}...`,
        sideEffect: `run-skill:${args[1]}`,
      };
    }
    return {
      success: true,
      message: `Skill "${action}" details: (from SkillLoader)`,
    };
  },
};
