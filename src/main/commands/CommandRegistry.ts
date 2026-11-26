/**
 * CommandRegistry — 命令注册、发现与执行中心。
 *
 * 职责：
 *  - 维护所有已注册的命令（内置 + 动态注册）；
 *  - 解析用户输入（"/command args"）并路由到对应命令；
 *  - 按类别列举命令供 UI 自动补全使用。
 */

import { commandText } from './commandI18n';
import type { CommandMessageKey } from './commandMessages';
import type { CommandContext, CommandResult, CommandExecuteRequest, CommandListResult } from '@shared/types/command';

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  /** 注册一个命令。同名命令会被覆盖（最后注册者胜出）。 */
  register(command: CommandDefinition): void {
    this.commands.set(command.name, command);
    // 同时注册别名
    if (command.aliases) {
      for (const alias of command.aliases) {
        if (!this.commands.has(alias)) {
          this.commands.set(alias, command);
        }
      }
    }
  }

  /** 注销一个命令。 */
  unregister(name: string): void {
    const cmd = this.commands.get(name);
    if (!cmd) return;
    this.commands.delete(name);
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        const existing = this.commands.get(alias);
        if (existing === cmd) {
          this.commands.delete(alias);
        }
      }
    }
  }

  /** 根据名称查找命令（支持别名）。 */
  resolve(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  /** 列出所有命令（去重，按主名称）。 */
  list(category?: string): CommandListResult['commands'] {
    const seen = new Set<string>();
    const result: CommandListResult['commands'] = [];
    for (const cmd of this.commands.values()) {
      if (seen.has(cmd.id)) continue;
      seen.add(cmd.id);
      if (category && cmd.category !== category) continue;
      result.push({
        id: cmd.id,
        name: cmd.name,
        description: commandText(cmd.descriptionKey),
        aliases: cmd.aliases ?? [],
        category: cmd.category,
      });
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** 解析原始输入并执行命令。 */
  async execute(request: CommandExecuteRequest): Promise<CommandResult> {
    const raw = request.input.trim();
    if (!raw.startsWith('/')) {
      return { success: false, message: commandText('registry.notCommand') };
    }

    const parts = raw.slice(1).split(/\s+/);
    const commandName = parts[0];
    const args = parts.slice(1);

    const cmd = this.resolve(commandName);
    if (!cmd) {
      return { success: false, message: commandText('registry.unknown', { name: commandName }) };
    }

    const context: CommandContext = {
      sessionId: request.context?.sessionId,
      projectId: request.context?.projectId,
      workspaceRoot: request.context?.workspaceRoot,
      agentId: request.context?.agentId,
      currentMode: request.context?.currentMode,
      currentModelId: request.context?.currentModelId,
      currentTheme: request.context?.currentTheme,
    };

    try {
      return await cmd.execute(args, context);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return { success: false, message: commandText('registry.failed', { name: commandName, reason }) };
    }
  }
}

/** Definition of a slash command. */
export interface CommandDefinition {
  /** Unique command ID (kebab-case, e.g. "help", "clear", "git-commit"). */
  id: string;
  /** Primary command name (without leading slash). */
  name: string;
  /** Short description shown in the command list popover and /help, in the app language. */
  descriptionKey: CommandMessageKey;
  /** Alternative names that trigger this command. */
  aliases?: string[];
  /** Category for grouping in the UI. */
  category: 'workflow' | 'navigation' | 'system' | 'debug' | 'edit' | 'session';
  /** Execute the command. Receives parsed arguments and context. */
  execute: (args: string[], context: CommandContext) => Promise<CommandResult>;
}
