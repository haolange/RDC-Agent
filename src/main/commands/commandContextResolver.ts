/**
 * commandContextResolver — 从主进程服务解析当前命令上下文。
 */

import type { CommandContext } from '@shared/types/command';

export function resolveCommandContext(
  sessionId?: string,
  projectId?: string,
  workspaceRoot?: string,
  agentId?: string,
  currentMode?: string,
  currentModelId?: string,
  currentTheme?: string,
): CommandContext {
  return {
    sessionId,
    projectId,
    workspaceRoot,
    agentId,
    currentMode,
    currentModelId,
    currentTheme,
  };
}
