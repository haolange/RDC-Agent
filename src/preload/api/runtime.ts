import { ipcRenderer } from 'electron';
import type { RuntimeLogApi, TerminalApi } from '@shared/types/electron-api';

export const createRuntimeLogApi = (): RuntimeLogApi => ({
  list: (request): ReturnType<RuntimeLogApi['list']> => ipcRenderer.invoke('runtimeLog:list', request),
});

export const createTerminalApi = (): TerminalApi => ({
  listTabs: (): ReturnType<TerminalApi['listTabs']> => ipcRenderer.invoke('terminal:listTabs'),
  createTab: (request): ReturnType<TerminalApi['createTab']> => ipcRenderer.invoke('terminal:createTab', request),
  closeTab: (tabId): ReturnType<TerminalApi['closeTab']> => ipcRenderer.invoke('terminal:closeTab', tabId),
  activateTab: (tabId): ReturnType<TerminalApi['activateTab']> => ipcRenderer.invoke('terminal:activateTab', tabId),
  write: (tabId, data): ReturnType<TerminalApi['write']> => ipcRenderer.invoke('terminal:write', tabId, data),
  resize: (tabId, cols, rows): ReturnType<TerminalApi['resize']> =>
    ipcRenderer.invoke('terminal:resize', tabId, cols, rows),
});
