import { ipcMain } from 'electron';
import type { CommandExecuteRequest, CommandListResult } from '@shared/types/command';
import { getRegistry } from '../commands/index';
import { CommandService } from '../commands/CommandService';
import { parseIpcArgs } from './validation/IpcPayloadGuard';
import {
  CommandExecuteArgsSchema,
  CommandListArgsSchema,
} from './validation/commandSchemas';

let commandService: CommandService | null = null;

function getCommandService(): CommandService {
  if (!commandService) {
    commandService = new CommandService(getRegistry());
  }
  return commandService;
}

export function registerCommandHandlers(): void {
  ipcMain.handle('command:list', (_event, ...rawArgs: unknown[]): CommandListResult => {
    const [category] = parseIpcArgs(CommandListArgsSchema, rawArgs, {
      label: 'command:list',
      maxBytes: 4 * 1024,
      padTo: 1,
    });
    const registry = getRegistry();
    return { commands: registry.list(category) };
  });

  ipcMain.handle('command:execute', async (_event, ...rawArgs: unknown[]) => {
    const [request] = parseIpcArgs(CommandExecuteArgsSchema, rawArgs, {
      label: 'command:execute',
      maxBytes: 64 * 1024,
    }) as [CommandExecuteRequest];
    const service = getCommandService();
    return service.execute(request);
  });
}
