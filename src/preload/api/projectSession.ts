import { ipcRenderer } from 'electron';
import type { ProjectApi, RunApi, SessionApi } from '@shared/types/electron-api';

export const createProjectApi = (): ProjectApi => ({
  list: (): ReturnType<ProjectApi['list']> => ipcRenderer.invoke('project:list'),
  add: (rootPath): ReturnType<ProjectApi['add']> => ipcRenderer.invoke('project:add', rootPath),
  select: (projectId): ReturnType<ProjectApi['select']> => ipcRenderer.invoke('project:select', projectId),
  rename: (projectId, newName): ReturnType<ProjectApi['rename']> =>
    ipcRenderer.invoke('project:rename', projectId, newName),
  remove: (projectId): ReturnType<ProjectApi['remove']> => ipcRenderer.invoke('project:remove', projectId),
  inputs: {
    list: (projectId): ReturnType<ProjectApi['inputs']['list']> => ipcRenderer.invoke('project:inputs:list', projectId),
    refresh: (projectId): ReturnType<ProjectApi['inputs']['refresh']> =>
      ipcRenderer.invoke('project:inputs:refresh', projectId),
    import: (projectId): ReturnType<ProjectApi['inputs']['import']> =>
      ipcRenderer.invoke('project:inputs:import', projectId),
    importPaths: (projectId, filePaths): ReturnType<ProjectApi['inputs']['importPaths']> =>
      ipcRenderer.invoke('project:inputs:importPaths', projectId, filePaths),
  },
});

export const createSessionApi = (): SessionApi => ({
  list: (projectId): ReturnType<SessionApi['list']> => ipcRenderer.invoke('session:list', projectId),
  create: (projectId, title): ReturnType<SessionApi['create']> =>
    ipcRenderer.invoke('session:create', projectId, title),
  rename: (id, title): ReturnType<SessionApi['rename']> => ipcRenderer.invoke('session:rename', id, title),
  remove: (id): ReturnType<SessionApi['remove']> => ipcRenderer.invoke('session:remove', id),
  select: (id): ReturnType<SessionApi['select']> => ipcRenderer.invoke('session:select', id),
  attachments: {
    list: (sessionId): ReturnType<SessionApi['attachments']['list']> =>
      ipcRenderer.invoke('session:attachments:list', sessionId),
    import: (sessionId, filePaths): ReturnType<SessionApi['attachments']['import']> =>
      ipcRenderer.invoke('session:attachments:import', sessionId, filePaths),
  },

});

export const createRunApi = (): RunApi => ({
  list: (sessionId): ReturnType<RunApi['list']> => ipcRenderer.invoke('run:list', sessionId),
});
