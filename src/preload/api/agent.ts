import { ipcRenderer } from 'electron';
import type { AgentApi } from '@shared/types/electron-api';

export const createAgentApi = (): AgentApi => ({
  sendMessage: (agentId, content): ReturnType<AgentApi['sendMessage']> =>
    ipcRenderer.invoke('agent:sendMessage', agentId, content),
  getState: (agentId): ReturnType<AgentApi['getState']> => ipcRenderer.invoke('agent:getState', agentId),
  getAllStates: (): ReturnType<AgentApi['getAllStates']> => ipcRenderer.invoke('agent:getAllStates'),
  configure: (agentId, config): ReturnType<AgentApi['configure']> =>
    ipcRenderer.invoke('agent:configure', agentId, config),
});
