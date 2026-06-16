/**
 * Command IPC handlers。
 */
import { ipcMain } from 'electron';
import type { CommandExecuteRequest, CommandListResult } from '@shared/types/command';
import { getRegistry } from '../commands/index';

export function registerCommandHandlers(): void {
  ipcMain.handle('command:list', (_event, category?: string): CommandListResult => {
    const registry = getRegistry();
    return { commands: registry.list(category) };
  });

  ipcMain.handle('command:execute', async (_event, request: CommandExecuteRequest) => {
    const registry = getRegistry();
    return registry.execute(request);
  });
}
