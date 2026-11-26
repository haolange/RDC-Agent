/**
 * /skills — 列出当前工作区的 Markdown Skills，或为下一条消息启用其中一个。
 */
import { agentRuntimeConfigService } from '../../settings/agent-manifests/AgentRuntimeConfigService';
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

export const skillsCommand: CommandDefinition = {
  id: 'skills',
  name: 'skills',
  descriptionKey: 'skills.description',
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
        message: lines.length > 0 ? lines.join('\n') : commandText('skills.none'),
        data: { skills },
      };
    }
    // `/skills run <id>` and `/skills <id>` both arm the Skill for the next message.
    const requested = args[0] === 'run' ? (args[1] ?? '') : args[0];
    const skill = skills.find(
      (entry) => entry.id === requested || entry.name === requested || entry.label === requested,
    );
    if (!skill) return { success: false, message: commandText('skills.notConfigured', { skill: requested }) };
    return {
      success: true,
      message: commandText('skills.armed', { skill: skill.id }),
      uiAction: { type: 'run-skill', payload: { skillId: skill.id, skillName: skill.label || skill.name } },
      data: { skill },
    };
  },
};
