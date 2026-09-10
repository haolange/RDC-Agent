/**
 * Command system — index.
 */
export { CommandRegistry } from './CommandRegistry';

import { CommandRegistry } from './CommandRegistry';
import { helpCommand } from './builtins/help';
import { clearCommand } from './builtins/clear';
import { configCommand } from './builtins/config';
import { modelCommand } from './builtins/model';
import { projectCommand } from './builtins/project';
import { sessionCommand } from './builtins/session';
import { toolsCommand } from './builtins/tools';
import { mcpCommand } from './builtins/mcp';
import { skillsCommand } from './builtins/skills';
import { planCommand } from './builtins/plan';
import { testCommand } from './builtins/test';
import { exportCommand } from './builtins/export';
import { statusCommand } from './builtins/status';
import { agentsCommand } from './builtins/agents';
import { versionCommand } from './builtins/version';
import { undoCommand } from './builtins/undo';
import { resumeCommand } from './builtins/resume';
import { costCommand } from './builtins/cost';
import { usageCommand } from './builtins/usage';
import { permissionsCommand } from './builtins/permissions';
import { themeCommand } from './builtins/theme';

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
    modelCommand,
    projectCommand,
    sessionCommand,
    toolsCommand,
    mcpCommand,
    skillsCommand,
    planCommand,
    testCommand,
    exportCommand,
    statusCommand,
    agentsCommand,
    versionCommand,
    undoCommand,
    resumeCommand,
    costCommand,
    usageCommand,
    permissionsCommand,
    themeCommand,
  ];
  for (const cmd of builtins) {
    registry.register(cmd);
  }
}
