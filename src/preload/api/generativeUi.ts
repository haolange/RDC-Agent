import { ipcRenderer } from 'electron';
import type { ElectronAPI } from '@shared/types/electron';

export const createGenerativeUiApi = (): ElectronAPI['generativeUi'] => ({
  run: (request) => ipcRenderer.invoke('generative-ui:run', request),
  create: (projectId, sessionId, title, prompt) => ipcRenderer.invoke('generative-ui:create', projectId, sessionId, title, prompt),
  list: (sessionId) => ipcRenderer.invoke('generative-ui:list', sessionId),
  metrics: (sessionId) => ipcRenderer.invoke('generative-ui:metrics', sessionId),
  evidenceList: (sessionId) => ipcRenderer.invoke('generative-ui:evidenceList', sessionId),
  evidenceAdd: (sessionId, request) => ipcRenderer.invoke('generative-ui:evidenceAdd', sessionId, request),
  outerReport: (sessionId) => ipcRenderer.invoke('generative-ui:outerReport', sessionId),
  benchmarkList: () => ipcRenderer.invoke('generative-ui:benchmarkList'),
  benchmarkRun: (projectId, sessionId, caseId) => ipcRenderer.invoke('generative-ui:benchmarkRun', projectId, sessionId, caseId),
  get: (sessionId, canvasId) => ipcRenderer.invoke('generative-ui:get', sessionId, canvasId),
  commit: (sessionId, request) => ipcRenderer.invoke('generative-ui:commit', sessionId, request),
  createBranch: (sessionId, canvasId, name, fromVersionId) => ipcRenderer.invoke('generative-ui:createBranch', sessionId, canvasId, name, fromVersionId),
  switchBranch: (sessionId, canvasId, branchId) => ipcRenderer.invoke('generative-ui:switchBranch', sessionId, canvasId, branchId),
  stop: (sessionId, canvasId, reason) => ipcRenderer.invoke('generative-ui:stop', sessionId, canvasId, reason),
  getPreview: (sessionId, canvasId, versionId) => ipcRenderer.invoke('generative-ui:getPreview', sessionId, canvasId, versionId),
  observe: (sessionId, canvasId, versionId, eventType, details) => ipcRenderer.invoke('generative-ui:observe', sessionId, canvasId, versionId, eventType, details),
  feedback: (sessionId, canvasId, versionId, value) => ipcRenderer.invoke('generative-ui:feedback', sessionId, canvasId, versionId, value),
  export: (sessionId, canvasId, versionId) => ipcRenderer.invoke('generative-ui:export', sessionId, canvasId, versionId),
});
