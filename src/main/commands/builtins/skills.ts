/**
 * /skills — 列出或执行可用技能。
 */
import type { CommandDefinition } from '@shared/types/command';

export const skillsCommand: CommandDefinition = {
  id: 'skills',
  name: 'skills',
  description: 'List available skills or run a specific skill',
  aliases: ['skill'],
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
      const skillId = args[1] ?? '';
      return {
        success: true,
        message: `Running skill: ${skillId || 'unnamed'}...`,
        uiAction: { type: 'run-skill', payload: { skillId } },
      };
    }
    return {
      success: true,
      message: `Skill "${action}" details: (from SkillLoader)`,
    };
  },
};
