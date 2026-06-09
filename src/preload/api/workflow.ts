import { ipcRenderer } from 'electron';
import type { WorkflowApi } from '@shared/types/electron-api';

export const createWorkflowApi = (): WorkflowApi => ({
  getState: (): ReturnType<WorkflowApi['getState']> => ipcRenderer.invoke('workflow:getState'),
  resume: (sessionId): ReturnType<WorkflowApi['resume']> => ipcRenderer.invoke('workflow:resume', sessionId),
  stop: (runId): ReturnType<WorkflowApi['stop']> => ipcRenderer.invoke('workflow:stop', runId),
  getRunUsage: (runId): ReturnType<WorkflowApi['getRunUsage']> => ipcRenderer.invoke('workflow:getRunUsage', runId),
  listRuns: (): ReturnType<WorkflowApi['listRuns']> => ipcRenderer.invoke('workflow:listRuns'),
  listActiveRuns: (): ReturnType<WorkflowApi['listActiveRuns']> => ipcRenderer.invoke('workflow:listActiveRuns'),
});

