/**
 * /debug — 调试信息与诊断。
 */
import type { CommandDefinition } from '@shared/types/command';

export const debugCommand: CommandDefinition = {
  id: 'debug',
  name: 'debug',
  description: 'Show debug/diagnostic information',
  aliases: ['diag', 'status'],
  category: 'debug',

  async execute(_args, ctx) {
    const info = {
      sessionId: ctx.sessionId ?? 'none',
      projectId: ctx.projectId ?? 'none',
      workspaceRoot: ctx.workspaceRoot ?? 'none',
      agentId: ctx.agentId ?? 'none',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    };
    const lines = Object.entries(info).map(([k, v]) => `  ${k}: ${v}`);
    return {
      success: true,
      message: `**Debug Info**\n${lines.join('\n')}`,
    };
  },
};
