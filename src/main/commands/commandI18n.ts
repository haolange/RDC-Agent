import { settingsService } from '../settings/settings-core/SettingsService';
import { commandTextFor, type CommandMessageKey } from './commandMessages';

/** Command output in the committed app language, read when the command runs. */
export const commandText = (key: CommandMessageKey, params?: Record<string, string | number>): string =>
  commandTextFor(settingsService.snapshot().user.appearance.language, key, params);
