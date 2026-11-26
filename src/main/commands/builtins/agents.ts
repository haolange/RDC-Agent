/**
 * /agents — 列出或切换可用 Agent。
 */
import { appPathService } from '../../runtime/AppPathService';
import { agentManifestService } from '../../settings/agent-manifests/AgentManifestService';
import { projectWorkspaceStore } from '../../sessions/store/sessionStores';
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

export const agentsCommand: CommandDefinition = {
  id: 'agents',
  name: 'agents',
  descriptionKey: 'agents.description',
  aliases: ['agent'],
  category: 'workflow',

  async execute(args, ctx) {
    if (args.length === 0) {
      const projectRoot = ctx.projectId ? projectWorkspaceStore.getProjectById(ctx.projectId)?.rootPath : undefined;
      // The Agents the person can pick in the composer: enabled and user-invocable in the effective snapshot.
      const agents = agentManifestService
        .resolveEffectiveSnapshot(appPathService.getRuntimePaths(), projectRoot)
        .profiles.filter((profile) => profile.enabled && profile.userInvocable)
        .map((profile) => profile.id);
      return { success: true, message: commandText('agents.list', { agents: agents.join(', ') }) };
    }
    const target = args[0];
    return {
      success: true,
      message: commandText('agents.switching', { agent: target }),
      uiAction: { type: 'switch-mode', payload: { agentId: target } },
    };
  },
};
