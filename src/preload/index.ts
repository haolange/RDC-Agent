/**
 * Electron Preload Script
 */

import { contextBridge, ipcRenderer } from 'electron';

const listenerMap = new Map<string, Map<(...args: unknown[]) => void, (...args: unknown[]) => void>>();

const validChannels = [
  'file:open',
  'case:new',
  'settings:open',
  'workflow:stateChanged',
  'workflow:stageChanged',
  'agent:message',
  'agent:statusChanged',
  'tool:executionComplete',
  'evidence:eventAdded',
  'llm:stream',
  'window:maximized-changed',
] as const;

const isValidChannel = (channel: string): channel is (typeof validChannels)[number] => {
  return validChannels.includes(channel as (typeof validChannels)[number]);
};

// 暴露给渲染进程的API
const electronAPI = {
  // 平台信息
  platform: process.platform,
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',

  appMeta: {
    get: (): Promise<{ version: string; productName: string }> => {
      return ipcRenderer.invoke('app:getMeta');
    },
  },

  // 文件操作
  selectRdcFiles: (): Promise<string[] | null> => {
    return ipcRenderer.invoke('dialog:selectRdcFiles');
  },

  selectDirectory: (): Promise<string | null> => {
    return ipcRenderer.invoke('dialog:selectDirectory');
  },

  // 工作流操作
  workflow: {
    getState: (): Promise<unknown> => {
      return ipcRenderer.invoke('workflow:getState');
    },
    start: (capturePaths: string[], userGoal: string): Promise<unknown> => {
      return ipcRenderer.invoke('workflow:start', capturePaths, userGoal);
    },
    advanceStage: (): Promise<unknown> => {
      return ipcRenderer.invoke('workflow:advanceStage');
    },
    backtrack: (reason: string, trigger: string): Promise<unknown> => {
      return ipcRenderer.invoke('workflow:backtrack', reason, trigger);
    },
    dispatchSpecialist: (agentId: string, objective: string): Promise<unknown> => {
      return ipcRenderer.invoke('workflow:dispatchSpecialist', agentId, objective);
    },
  },

  // Agent操作
  agent: {
    sendMessage: (agentId: string, content: string): Promise<unknown> => {
      return ipcRenderer.invoke('agent:sendMessage', agentId, content);
    },
    getState: (agentId: string): Promise<unknown> => {
      return ipcRenderer.invoke('agent:getState', agentId);
    },
    getAllStates: (): Promise<unknown> => {
      return ipcRenderer.invoke('agent:getAllStates');
    },
    configure: (agentId: string, config: unknown): Promise<unknown> => {
      return ipcRenderer.invoke('agent:configure', agentId, config);
    },
  },

  // 工具操作
  tool: {
    getCatalog: (): Promise<unknown> => {
      return ipcRenderer.invoke('tool:getCatalog');
    },
    execute: (toolName: string, args: unknown): Promise<unknown> => {
      return ipcRenderer.invoke('tool:execute', toolName, args);
    },
  },

  // 证据链操作
  evidence: {
    getChain: (): Promise<unknown> => {
      return ipcRenderer.invoke('evidence:getChain');
    },
    getEvents: (eventType?: string): Promise<unknown> => {
      return ipcRenderer.invoke('evidence:getEvents', eventType);
    },
  },

  // LLM操作
  llm: {
    configure: (config: unknown): Promise<void> => {
      return ipcRenderer.invoke('llm:configure', config);
    },
    testConnection: (provider: string): Promise<unknown> => {
      return ipcRenderer.invoke('llm:testConnection', provider);
    },
    getAvailableModels: (provider: string): Promise<unknown> => {
      return ipcRenderer.invoke('llm:getAvailableModels', provider);
    },
  },

  // 设置操作
  settings: {
    get: (): Promise<unknown> => {
      return ipcRenderer.invoke('settings:get');
    },
    set: (settings: unknown): Promise<void> => {
      return ipcRenderer.invoke('settings:set', settings);
    },
  },

  windowControls: {
    minimize: (): Promise<void> => {
      return ipcRenderer.invoke('window:minimize');
    },
    toggleMaximize: (): Promise<boolean> => {
      return ipcRenderer.invoke('window:toggleMaximize');
    },
    close: (): Promise<void> => {
      return ipcRenderer.invoke('window:close');
    },
    isMaximized: (): Promise<boolean> => {
      return ipcRenderer.invoke('window:isMaximized');
    },
  },

  // 事件监听
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    if (isValidChannel(channel)) {
      const wrappedCallback = (_event: unknown, ...args: unknown[]) => callback(...args);
      const channelListeners = listenerMap.get(channel) ?? new Map();
      channelListeners.set(callback, wrappedCallback);
      listenerMap.set(channel, channelListeners);
      ipcRenderer.on(channel, wrappedCallback);
    }
  },

  off: (channel: string, callback: (...args: unknown[]) => void) => {
    const wrappedCallback = listenerMap.get(channel)?.get(callback);
    if (wrappedCallback) {
      ipcRenderer.removeListener(channel, wrappedCallback as Parameters<typeof ipcRenderer.removeListener>[1]);
      listenerMap.get(channel)?.delete(callback);
    }
  },
};

// 暴露API到渲染进程
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// 类型导出
export type ElectronAPI = typeof electronAPI;
