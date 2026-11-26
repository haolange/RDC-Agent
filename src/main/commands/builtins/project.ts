/**
 * /project — 列出项目；项目在侧边栏管理。
 */
import { projectWorkspaceStore } from '../../sessions/store/sessionStores';
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

export const projectCommand: CommandDefinition = {
  id: 'project',
  name: 'project',
  descriptionKey: 'project.description',
  aliases: ['prj'],
  category: 'navigation',

  async execute(args, ctx) {
    if ((args[0] ?? 'list') !== 'list') return { success: false, message: commandText('project.sidebar') };
    const projects = projectWorkspaceStore.listProjects();
    if (projects.length === 0) return { success: true, message: commandText('project.none') };
    const lines = projects.map(
      (project) =>
        `- ${project.name}${project.projectId === ctx.projectId ? ` (${commandText('project.current')})` : ''}`,
    );
    return { success: true, message: `${commandText('project.list')}\n${lines.join('\n')}` };
  },
};
