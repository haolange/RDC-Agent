/**
 * /version — 显示应用版本信息。
 */
import { app } from 'electron';
import type { CommandDefinition } from '@shared/types/command';

function resolveAppVersion(): string {
  try {
    return app.getVersion();
  } catch {
    return process.env.npm_package_version ?? '0.6.0';
  }
}

export const versionCommand: CommandDefinition = {
  id: 'version',
  name: 'version',
  description: 'Show application version information',
  aliases: ['v'],
  category: 'system',

  async execute() {
    return {
      success: true,
      message: `RDC Agent v${resolveAppVersion()}\nElectron: ${process.versions.electron ?? 'N/A'}\nNode: ${process.version}\nChrome: ${process.versions.chrome ?? 'N/A'}`,
    };
  },
};
