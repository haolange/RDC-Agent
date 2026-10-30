import type { CommandListResult } from '@shared/types/command';
import type { Translator, TranslationKey } from '../i18n/messages';
const DESCRIPTION_KEYS: Record<string, TranslationKey> = {
  agents: 'composer.commandDescription.agents',
  clear: 'composer.commandDescription.clear',
  cost: 'composer.commandDescription.cost',
  config: 'composer.commandDescription.config',
  help: 'composer.commandDescription.help',
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
/** The command list stays main-owned; only builtin display copy is localized here. */
export function localizeCommands(commands: CommandListResult['commands'], t: Translator): CommandListResult['commands'] {
  return commands.map(command => ({ ...command,
    description: DESCRIPTION_KEYS[command.id] ? t(DESCRIPTION_KEYS[command.id]) : command.description,
    category: CATEGORY_KEYS[command.category] ? t(CATEGORY_KEYS[command.category]) : command.category,
  }));
}
