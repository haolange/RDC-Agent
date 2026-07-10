import { ipcRenderer } from 'electron';
import type { ElectronAPI } from '@shared/types/electron';

export const createRdxRuntimeApi = (): ElectronAPI['rdxRuntime'] => ({
  getOverview: (projectRoot) => ipcRenderer.invoke('rdx-runtime:overview', projectRoot),
  validateResource: (request) => ipcRenderer.invoke('rdx-runtime:validate', request),
  upsertResource: (request) => ipcRenderer.invoke('rdx-runtime:upsert', request),
  deleteResource: (kind, scope, id, projectRoot) => ipcRenderer.invoke('rdx-runtime:delete', kind, scope, id, projectRoot),
  revealResource: (sourcePath) => ipcRenderer.invoke('rdx-runtime:reveal', sourcePath),
  trustHook: (projectRoot, hookId) => ipcRenderer.invoke('rdx-runtime:trustHook', projectRoot, hookId),
  revokeHook: (projectRoot, hookId) => ipcRenderer.invoke('rdx-runtime:revokeHook', projectRoot, hookId),
  testHook: (event, projectRoot, hookId) => ipcRenderer.invoke('rdx-runtime:testHook', event, projectRoot, hookId),
  listRequestSnapshots: (sessionId, turnId) => ipcRenderer.invoke('rdx-runtime:listSnapshots', sessionId, turnId),
  getRequestSnapshot: (sessionId, turnId, snapshotId) => ipcRenderer.invoke('rdx-runtime:getSnapshot', sessionId, turnId, snapshotId),
});
