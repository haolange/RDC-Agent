import { ipcRenderer } from 'electron';
import type { EvidenceApi, ToolApi } from '@shared/types/electron-api';

export const createToolApi = (): ToolApi => ({
  getCatalog: (): ReturnType<ToolApi['getCatalog']> => ipcRenderer.invoke('tool:getCatalog'),
  getRuntimeSummary: (): ReturnType<ToolApi['getRuntimeSummary']> => ipcRenderer.invoke('tool:getRuntimeSummary'),
  execute: (toolName, args): ReturnType<ToolApi['execute']> => ipcRenderer.invoke('tool:execute', toolName, args),
});

export const createEvidenceApi = (): EvidenceApi => ({
  getChain: (): ReturnType<EvidenceApi['getChain']> => ipcRenderer.invoke('evidence:getChain'),
  getEvents: (eventType): ReturnType<EvidenceApi['getEvents']> => ipcRenderer.invoke('evidence:getEvents', eventType),
});
