import { ipcRenderer } from 'electron';
import type { ElectronAPI } from '@shared/types/electron';

export const createTraceApi = (): ElectronAPI['trace'] => ({
  getRun: (runId) => ipcRenderer.invoke('trace:getRun', runId),
  getEvents: (runId, afterSeq) => ipcRenderer.invoke('trace:getEvents', runId, afterSeq),
  getProjection: (sessionId) => ipcRenderer.invoke('trace:getProjection', sessionId),
  exportRun: (runId) => ipcRenderer.invoke('trace:exportRun', runId),
  switchBranch: (sessionId, branchId) => ipcRenderer.invoke('trace:switchBranch', sessionId, branchId),
  exportSession: (sessionId, options) => ipcRenderer.invoke('trace:exportSession', sessionId, options),
});
