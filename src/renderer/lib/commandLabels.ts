import { AGENT_WORKBENCH_COMMAND_CATALOG } from '@shared/constants/agentWorkbenchCatalog';
import type { CommandListResult } from '@shared/types/command';
import type { Translator, TranslationKey } from '../i18n/messages';

export const WORKBENCH_COMMAND_DESCRIPTION_KEYS: Record<string, TranslationKey> = {
  '/help': 'composer.commandDescription.help',
  '/context': 'composer.commandDescription.context',
  '/memory': 'composer.commandDescription.memory',
  '/agents': 'composer.commandDescription.agents',
  '/skills': 'composer.commandDescription.skills',
  '/mcp': 'composer.commandDescription.mcp',
  '/status': 'composer.commandDescription.status',
  '/model': 'composer.commandDescription.model',
};

export function workbenchCommandDescriptionKey(command: string): TranslationKey {
  const key = WORKBENCH_COMMAND_DESCRIPTION_KEYS[command];
  if (!key) throw new Error(`WORKBENCH_COMMAND_COPY_MISSING: ${command}`);
  return key;
}

export function assertWorkbenchCommandCopy(): void {
  for (const entry of AGENT_WORKBENCH_COMMAND_CATALOG) workbenchCommandDescriptionKey(entry.command);
}

const DESCRIPTION_KEYS: Record<string, TranslationKey> = {
  agents: 'composer.commandDescription.agents',
  clear: 'composer.commandDescription.clear',
  cost: 'composer.commandDescription.cost',
  config: 'composer.commandDescription.config',
  help: 'composer.commandDescription.help',
  context: 'composer.commandDescription.context',
  memory: 'composer.commandDescription.memory',
  export: 'composer.commandDescription.export',
  model: 'composer.commandDescription.model',
  mcp: 'composer.commandDescription.mcp',
  permissions: 'composer.commandDescription.permissions',
  project: 'composer.commandDescription.project',
  session: 'composer.commandDescription.session',
  resume: 'composer.commandDescription.resume',
  skills: 'composer.commandDescription.skills',
  status: 'composer.commandDescription.status',
  test: 'composer.commandDescription.test',
  theme: 'composer.commandDescription.theme',
  undo: 'composer.commandDescription.undo',
  tools: 'composer.commandDescription.tools',
  usage: 'composer.commandDescription.usage',
  version: 'composer.commandDescription.version',
};
const CATEGORY_KEYS: Record<string, TranslationKey> = {
  workflow: 'composer.commandCategory.workflow',
  navigation: 'composer.commandCategory.navigation',
  system: 'composer.commandCategory.system',
  debug: 'composer.commandCategory.debug',
  edit: 'composer.commandCategory.edit',
  session: 'composer.commandCategory.session',
};
/** A command as the interface shows it: the main-owned entry plus its description and category in words. */
export type LocalizedCommand = CommandListResult['commands'][number] & { categoryLabel: string };

/** The command list stays main-owned; only builtin display copy is localized here. The raw category stays for icons. */
export function localizeCommands(commands: CommandListResult['commands'], t: Translator): LocalizedCommand[] {
  return commands.map(command => ({ ...command,
    description: DESCRIPTION_KEYS[command.id] ? t(DESCRIPTION_KEYS[command.id]) : command.description,
    categoryLabel: CATEGORY_KEYS[command.category] ? t(CATEGORY_KEYS[command.category]) : command.category,
  }));
}
