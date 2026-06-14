/**
 * /help — 列出所有可用命令或查看某个命令的详情。
 */
import type { CommandDefinition } from '@shared/types/command';
import { getRegistry } from '../index';

export const helpCommand: CommandDefinition = {
  id: 'help',
  name: 'help',
  description: 'List all available commands or get details for a specific command',
  aliases: ['h', '?'],
  category: 'system',

  async execute(args) {
    const registry = getRegistry();
    const all = registry.list();

    if (args.length > 0) {
      const cmd = registry.resolve(args[0]);
      if (!cmd) {
        return {
          success: false,
          message: `Unknown command: /${args[0]}`,
        };
      }
      const aliases = cmd.aliases?.length ? ` (aliases: ${cmd.aliases.join(', ')})` : '';
      return {
        success: true,
        message: `**/${cmd.name}**${aliases} — ${cmd.category}\n${cmd.description}`,
      };
    }

    const byCategory = new Map<string, string[]>();
    for (const c of all) {
      const group = byCategory.get(c.category) ?? [];
      group.push(`/${c.name} — ${c.description}`);
      byCategory.set(c.category, group);
    }

    let output = `**Available Commands** (${all.length} total)\n\n`;
    for (const [cat, lines] of byCategory) {
      output += `**${cat}**\n${lines.map((l) => `  ${l}`).join('\n')}\n\n`;
    }
    output += 'Type `/help <command>` for details.';

    return { success: true, message: output };
  },
};
