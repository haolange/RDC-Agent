import { ipcRenderer } from 'electron';
import type { GitApi } from '@shared/types/electron-api';
import type { GitCommitRequest, GitDiffRequest, GitPathRequest } from '@shared/types/git';

export const createGitApi = (): GitApi => ({
  getStatus: () => ipcRenderer.invoke('git:getStatus'),
  getDiff: (request?: GitDiffRequest) => ipcRenderer.invoke('git:getDiff', request),
  stage: (request: GitPathRequest) => ipcRenderer.invoke('git:stage', request),
  stageAll: () => ipcRenderer.invoke('git:stageAll'),
  unstage: (request: GitPathRequest) => ipcRenderer.invoke('git:unstage', request),
  unstageAll: () => ipcRenderer.invoke('git:unstageAll'),
  commit: (request: GitCommitRequest) => ipcRenderer.invoke('git:commit', request),
});
