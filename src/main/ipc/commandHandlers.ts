import { ipcMain } from 'electron';
import type { CommandExecuteRequest, CommandListResult } from '@shared/types/command';
import { getRegistry } from '../commands/index';
import { CommandService } from '../commands/CommandService';

let commandService: CommandService | null = null;

function getCommandService(): CommandService {
  if (!commandService) {
    commandService = new CommandService(getRegistry());
  }
  return commandService;
}

export function registerCommandHandlers(): void {
  ipcMain.handle('command:list', (_event, category?: string): CommandListResult => {
    const registry = getRegistry();
    return { commands: registry.list(category) };
  });

  ipcMain.handle('command:execute', async (_event, request: CommandExecuteRequest) => {
    const service = getCommandService();
    return service.execute(request);
  });
}
