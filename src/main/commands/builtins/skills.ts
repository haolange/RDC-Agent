/**
 * /skills — 列出或执行当前工作区的 Markdown Skills。
 */
import type { CommandDefinition } from '@shared/types/command';
import { agentRuntimeConfigService } from '../../settings/AgentRuntimeConfigService';

export const skillsCommand: CommandDefinition = {
  id: 'skills',
  name: 'skills',
  description: 'List available Markdown Skills or run one by id',
  aliases: ['skill'],
  category: 'workflow',

  async execute(args, context) {
    const skills = agentRuntimeConfigService.listSkills(context.workspaceRoot);
    if (args.length === 0) {
      const lines = skills.map((skill) => {
        const summary = skill.description ? ` - ${skill.description}` : '';
        return `- ${skill.id}: ${skill.label || skill.name}${summary}`;
      });
      return {
        success: true,
        message: lines.length > 0 ? lines.join('\n') : 'No Markdown Skills are available in this workspace.',
        data: { skills },
      };
    }
    const action = args[0];
    const resolveSkill = (rawId: string) => skills.find((entry) => (
      entry.id === rawId || entry.name === rawId || entry.label === rawId
    ));
    if (action === 'run') {
      const skillId = args[1] ?? '';
      const skill = resolveSkill(skillId);
      if (!skill) {
        return {
          success: false,
          message: `Skill is not configured: ${skillId || 'unnamed'}`,
        };
      }
      return {
        success: true,
        message: `Armed skill for next send: ${skill.id}`,
        uiAction: { type: 'run-skill', payload: { skillId: skill.id } },
        data: { skill },
      };
    }
    const skill = resolveSkill(action);
    if (!skill) {
      return {
        success: false,
        message: `Skill is not configured: ${action}`,
      };
    }
    return {
      success: true,
      message: `Armed skill for next send: ${skill.id}`,
      uiAction: { type: 'run-skill', payload: { skillId: skill.id } },
      data: { skill },
    };
  },
};
