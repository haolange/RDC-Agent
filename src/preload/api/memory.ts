import { ipcRenderer } from 'electron';
import type { MemoryApi } from '@shared/types/electron-api';

export const createMemoryApi = (): MemoryApi => ({
  list: (): ReturnType<MemoryApi['list']> => ipcRenderer.invoke('memory:list'),
  get: (name): ReturnType<MemoryApi['get']> => ipcRenderer.invoke('memory:get', name),
  write: (request): ReturnType<MemoryApi['write']> => ipcRenderer.invoke('memory:write', request),
  delete: (name): ReturnType<MemoryApi['delete']> => ipcRenderer.invoke('memory:delete', name),
});
