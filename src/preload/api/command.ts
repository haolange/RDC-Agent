import { ipcRenderer } from 'electron';
import type { CommandApi } from '@shared/types/electron-api';
import type { CommandExecuteRequest, CommandResult } from '@shared/types/command';

export const createCommandApi = (): CommandApi => ({
  list: (category?) => ipcRenderer.invoke('command:list', category),
  execute: (request: CommandExecuteRequest) => ipcRenderer.invoke('command:execute', request) as Promise<{
    result: CommandResult;
    systemMessage?: import('@shared/types/conversation').ConversationMessage;
  }>,
});
