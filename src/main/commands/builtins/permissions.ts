import { runtimePermissionStateService } from '../../runtime/RuntimePermissionStateService';
import { commandText } from '../commandI18n';
import type { CommandDefinition } from '../CommandRegistry';

const PERMISSION_MODES = new Set(['default', 'auto-review', 'full-access', 'custom']);

export const permissionsCommand: CommandDefinition = {
  id: 'permissions',
  name: 'permissions',
  descriptionKey: 'permissions.description',
  aliases: ['perm'],
  category: 'system',

  async execute(args) {
    if (args.length === 0) {
      // The mode the runtime enforces right now, not a default.
      const { mode } = runtimePermissionStateService.getSnapshot();
      return { success: true, message: commandText('permissions.current', { mode }), data: { mode } };
    }
    const mode = args[0];
    if (!PERMISSION_MODES.has(mode)) return { success: false, message: commandText('permissions.invalid') };
    return {
      success: true,
      message: commandText('permissions.switching', { mode }),
      uiAction: { type: 'switch-permissions', payload: { mode } },
    };
  },
};
