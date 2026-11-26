/**
 * /help — 列出所有可用命令或查看某个命令的详情。
 */
import { commandText } from '../commandI18n';
import type { CommandDefinition, CommandRegistry } from '../CommandRegistry';

const categoryLabel = (category: CommandDefinition['category']) => commandText(`category.${category}`);

/** The registry is handed in by the one that registers this command, so the command never imports its registrar. */
export const createHelpCommand = (registry: CommandRegistry): CommandDefinition => ({
  id: 'help',
  name: 'help',
  descriptionKey: 'help.description',
  aliases: ['h', '?'],
  category: 'system',

  async execute(args) {
    if (args.length > 0) {
      const cmd = registry.resolve(args[0]);
      if (!cmd) return { success: false, message: commandText('help.unknown', { name: args[0] }) };
      const aliases = cmd.aliases?.length ? commandText('help.aliases', { aliases: cmd.aliases.join(', ') }) : '';
      return {
        success: true,
        message: `**/${cmd.name}**${aliases} — ${categoryLabel(cmd.category)}\n${commandText(cmd.descriptionKey)}`,
      };
    }

    const all = registry.list();
    const byCategory = new Map<string, string[]>();
    for (const c of all) {
      const group = byCategory.get(c.category) ?? [];
      group.push(`/${c.name} — ${c.description}`);
      byCategory.set(c.category, group);
    }
    let output = `${commandText('help.title', { count: all.length })}\n\n`;
    for (const [category, lines] of byCategory) {
      output += `**${categoryLabel(category as CommandDefinition['category'])}**\n${lines.map((l) => `  ${l}`).join('\n')}\n\n`;
    }
    output += commandText('help.footer');
    return { success: true, message: output };
  },
});
