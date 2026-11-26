/**
 * /version — 显示应用版本信息。
 */
import { app } from 'electron';
import type { CommandDefinition } from '../CommandRegistry';

export const versionCommand: CommandDefinition = {
  id: 'version',
  name: 'version',
  description: 'Show application version information',
  aliases: ['v'],
  category: 'system',

  async execute() {
    return {
      success: true,
      message: `RDC Agent v${app.getVersion()}\nElectron: ${process.versions.electron}\nNode: ${process.version}\nChrome: ${process.versions.chrome}`,
    };
  },
};
