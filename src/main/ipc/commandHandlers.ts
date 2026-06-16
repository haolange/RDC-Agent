/**
 * Command IPC handlers。
 */
import { ipcMain } from 'electron';
import type { CommandExecuteRequest, CommandListResult } from '@shared/types/command';
import { getRegistry } from '../commands/index';
import { CommandService } from '../commands/CommandService';

let _commandService: CommandService | null = null;

function getCommandService(): CommandService {
  if (!_commandService) {
    _commandService = new CommandService(getRegistry());
  }
  return _commandService;
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
