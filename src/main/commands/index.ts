/**
 * Command system — index.
 */
export { CommandRegistry } from './CommandRegistry';

import { CommandRegistry } from './CommandRegistry';
import { helpCommand } from './builtins/help';
import { clearCommand } from './builtins/clear';
import { configCommand } from './builtins/config';
import { modeCommand } from './builtins/mode';
import { modelCommand } from './builtins/model';
import { projectCommand } from './builtins/project';
import { sessionCommand } from './builtins/session';
import { workspaceCommand } from './builtins/workspace';
import { toolCommand } from './builtins/tool';
import { mcpCommand } from './builtins/mcp';
import { skillCommand } from './builtins/skill';
import { planCommand } from './builtins/plan';
import { testCommand } from './builtins/test';
import { exportCommand } from './builtins/export';
import { debugCommand } from './builtins/debug';
import { commitCommand, diffCommand, reviewCommand } from './builtins/commit';

let _registry: CommandRegistry | null = null;

/** 获取全局单例 CommandRegistry。 */
export function getRegistry(): CommandRegistry {
  if (!_registry) {
    _registry = new CommandRegistry();
    registerBuiltins(_registry);
  }
  return _registry;
}

/** 将所有内置命令注册到 registry。 */
function registerBuiltins(registry: CommandRegistry): void {
  const builtins = [
    helpCommand,
    clearCommand,
    configCommand,
    modeCommand,
    modelCommand,
    projectCommand,
    sessionCommand,
    workspaceCommand,
    toolCommand,
    mcpCommand,
    skillCommand,
    planCommand,
    testCommand,
    exportCommand,
    debugCommand,
    commitCommand,
    diffCommand,
    reviewCommand,
  ];
  for (const cmd of builtins) {
    registry.register(cmd);
  }
}
