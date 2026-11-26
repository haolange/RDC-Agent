/**
 * /status — 系统状态与诊断信息。
 */
import { currentHost } from '../../platform/host';
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

export const statusCommand: CommandDefinition = {
  id: 'status',
  name: 'status',
  descriptionKey: 'status.description',
  aliases: ['st', 'debug', 'diag'],
  category: 'debug',

  async execute(_args, ctx) {
    const info = {
      sessionId: ctx.sessionId ?? 'none',
      projectId: ctx.projectId ?? 'none',
      workspaceRoot: ctx.workspaceRoot ?? 'none',
      agentId: ctx.agentId ?? 'none',
      currentMode: ctx.currentMode ?? 'none',
      currentModelId: ctx.currentModelId ?? 'none',
      nodeVersion: process.version,
      platform: currentHost().platform,
      arch: currentHost().arch,
    };
    const lines = Object.entries(info).map(([k, v]) => `  ${k}: ${v}`);
    return { success: true, message: `${commandText('status.title')}\n${lines.join('\n')}` };
  },
};
