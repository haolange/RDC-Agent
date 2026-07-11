import { ipcRenderer } from 'electron';
import type { EvidenceApi, McpApi, ToolApi } from '@shared/types/electron-api';

export const createToolApi = (): ToolApi => ({
  getCatalog: (): ReturnType<ToolApi['getCatalog']> => ipcRenderer.invoke('tool:getCatalog'),
  getRuntimeSummary: (): ReturnType<ToolApi['getRuntimeSummary']> => ipcRenderer.invoke('tool:getRuntimeSummary'),
});

export const createMcpApi = (): McpApi => ({
  getStatusSummary: (): ReturnType<McpApi['getStatusSummary']> => ipcRenderer.invoke('mcp:getStatusSummary'),
});

export const createEvidenceApi = (): EvidenceApi => ({
  getChain: (): ReturnType<EvidenceApi['getChain']> => ipcRenderer.invoke('evidence:getChain'),
  getEvents: (eventType): ReturnType<EvidenceApi['getEvents']> => ipcRenderer.invoke('evidence:getEvents', eventType),
});
