import { ipcRenderer } from 'electron';
import type { MemoryApi } from '@shared/types/electron-api';

export const createMemoryApi = (): MemoryApi => ({
  issueApprovalToken: (request): ReturnType<MemoryApi['issueApprovalToken']> => (
    ipcRenderer.invoke('memory:issueApprovalToken', request)
  ),
  list: (scope, projectRoot): ReturnType<MemoryApi['list']> => ipcRenderer.invoke('memory:list', scope, projectRoot),
  get: (scope, name, projectRoot): ReturnType<MemoryApi['get']> => ipcRenderer.invoke('memory:get', scope, name, projectRoot),
  write: (request): ReturnType<MemoryApi['write']> => ipcRenderer.invoke('memory:write', request),
  delete: (scope, name, approvalToken, projectRoot): ReturnType<MemoryApi['delete']> => (
    ipcRenderer.invoke('memory:delete', scope, name, approvalToken, projectRoot)
  ),
});
