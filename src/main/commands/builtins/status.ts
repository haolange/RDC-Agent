/**
 * /status — 系统状态与诊断信息。
 */
import type { CommandDefinition } from '@shared/types/command';

export const statusCommand: CommandDefinition = {
  id: 'status',
  name: 'status',
  description: 'Show system status and diagnostic information',
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
      platform: process.platform,
      arch: process.arch,
    };
    const lines = Object.entries(info).map(([k, v]) => `  ${k}: ${v}`);
    return {
      success: true,
      message: `**System Status**\n${lines.join('\n')}`,
    };
  },
};
