import { ipcRenderer } from 'electron';
import type { WorkflowApi } from '@shared/types/electron-api';

export const createWorkflowApi = (): WorkflowApi => ({
  getState: (): ReturnType<WorkflowApi['getState']> => ipcRenderer.invoke('workflow:getState'),
  start: (request): ReturnType<WorkflowApi['start']> => ipcRenderer.invoke('workflow:start', request),
  getPlan: (runId): ReturnType<WorkflowApi['getPlan']> => ipcRenderer.invoke('workflow:getPlan', runId),
  submitQuestions: (runId, answers): ReturnType<WorkflowApi['submitQuestions']> =>
    ipcRenderer.invoke('workflow:submitQuestions', runId, answers),
  approvePlan: (runId): ReturnType<WorkflowApi['approvePlan']> => ipcRenderer.invoke('workflow:approvePlan', runId),
  getWorkstreamSession: (sessionId): ReturnType<WorkflowApi['getWorkstreamSession']> =>
    ipcRenderer.invoke('workflow:getWorkstreamSession', sessionId),
  requestPlanRevision: (runId, revisionText): ReturnType<WorkflowApi['requestPlanRevision']> =>
    ipcRenderer.invoke('workflow:requestPlanRevision', runId, revisionText),
  switchWorkstreamBranch: (sessionId, branchId): ReturnType<WorkflowApi['switchWorkstreamBranch']> =>
    ipcRenderer.invoke('workflow:switchWorkstreamBranch', sessionId, branchId),
  exportWorkstreamSession: (sessionId, options): ReturnType<WorkflowApi['exportWorkstreamSession']> =>
    ipcRenderer.invoke('workflow:exportWorkstreamSession', sessionId, options),
  restartRun: (runId): ReturnType<WorkflowApi['restartRun']> => ipcRenderer.invoke('workflow:restartRun', runId),
  resume: (sessionId): ReturnType<WorkflowApi['resume']> => ipcRenderer.invoke('workflow:resume', sessionId),
  stop: (runId): ReturnType<WorkflowApi['stop']> => ipcRenderer.invoke('workflow:stop', runId),
  getRunUsage: (runId): ReturnType<WorkflowApi['getRunUsage']> => ipcRenderer.invoke('workflow:getRunUsage', runId),
  listRuns: (): ReturnType<WorkflowApi['listRuns']> => ipcRenderer.invoke('workflow:listRuns'),
  listActiveRuns: (): ReturnType<WorkflowApi['listActiveRuns']> => ipcRenderer.invoke('workflow:listActiveRuns'),
});
