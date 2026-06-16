/**
 * /version — 显示应用版本信息。
 */
import type { CommandDefinition } from '@shared/types/command';

export const versionCommand: CommandDefinition = {
  id: 'version',
  name: 'version',
  description: 'Show application version information',
  aliases: ['v'],
  category: 'system',

  async execute() {
    return {
      success: true,
      message: `RDC Agent v1.0.0\nElectron: ${process.versions.electron ?? 'N/A'}\nNode: ${process.version}\nChrome: ${process.versions.chrome ?? 'N/A'}`,
    };
  },
};
