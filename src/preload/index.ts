/**
 * Electron Preload Script
 */

import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, AppSettingsPatch } from '@shared/types/settings';
import type { OpenedCaptureState, ProjectInputRecord, ProjectRecord, SessionRecord } from '@shared/types/session';

const listenerMap = new Map<string, Map<(...args: unknown[]) => void, (...args: unknown[]) => void>>();

const validChannels = [
  'file:open',
  'case:new',
  'settings:open',
  'app:themeChanged',
  'workflow:stateChanged',
  'workflow:stageChanged',
  'agent:message',
  'agent:statusChanged',
  'tool:executionComplete',
  'evidence:eventAdded',
  'llm:stream',
  'window:maximized-changed',
  'device:statusChanged',
  'capture:statusChanged',
  'context:changed',
  'project:inputsChanged',
  'capture:openedStateChanged',
] as const;

const isValidChannel = (channel: string): channel is (typeof validChannels)[number] => {
  return validChannels.includes(channel as (typeof validChannels)[number]);
};

const electronAPI = {
  platform: process.platform,
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',

  appMeta: {
    get: (): Promise<{ version: string; productName: string; systemTheme: 'dark' | 'light' }> => ipcRenderer.invoke('app:getMeta'),
  },

  appShell: {
    selectAvatar: (): Promise<string | null> => ipcRenderer.invoke('app:selectAvatar'),
    openPath: (targetPath: string): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke('app:openPath', targetPath),
    copyText: (text: string): Promise<{ success: boolean }> => ipcRenderer.invoke('app:copyText', text),
  },

  selectRdcFiles: (): Promise<string[] | null> => ipcRenderer.invoke('dialog:selectRdcFiles'),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectDirectory'),

  workflow: {
    getState: (): Promise<unknown> => ipcRenderer.invoke('workflow:getState'),
    start: (request: unknown): Promise<unknown> => ipcRenderer.invoke('workflow:start', request),
    resume: (sessionId?: string): Promise<unknown> => ipcRenderer.invoke('workflow:resume', sessionId),
    listRuns: (): Promise<unknown> => ipcRenderer.invoke('workflow:listRuns'),
    advanceStage: (): Promise<unknown> => ipcRenderer.invoke('workflow:advanceStage'),
    backtrack: (reason: string, trigger: string): Promise<unknown> => ipcRenderer.invoke('workflow:backtrack', reason, trigger),
    dispatchSpecialist: (agentId: string, objective: string): Promise<unknown> => ipcRenderer.invoke('workflow:dispatchSpecialist', agentId, objective),
  },

  agent: {
    sendMessage: (agentId: string, content: string): Promise<unknown> => ipcRenderer.invoke('agent:sendMessage', agentId, content),
    getState: (agentId: string): Promise<unknown> => ipcRenderer.invoke('agent:getState', agentId),
    getAllStates: (): Promise<unknown> => ipcRenderer.invoke('agent:getAllStates'),
    configure: (agentId: string, config: unknown): Promise<unknown> => ipcRenderer.invoke('agent:configure', agentId, config),
  },

  tool: {
    getCatalog: (): Promise<unknown> => ipcRenderer.invoke('tool:getCatalog'),
    execute: (toolName: string, args: unknown): Promise<unknown> => ipcRenderer.invoke('tool:execute', toolName, args),
  },

  evidence: {
    getChain: (): Promise<unknown> => ipcRenderer.invoke('evidence:getChain'),
    getEvents: (eventType?: string): Promise<unknown> => ipcRenderer.invoke('evidence:getEvents', eventType),
  },

  llm: {
    configure: (config: unknown): Promise<void> => ipcRenderer.invoke('llm:configure', config),
    testConnection: (provider: string): Promise<unknown> => ipcRenderer.invoke('llm:testConnection', provider),
    getAvailableModels: (provider: string): Promise<unknown> => ipcRenderer.invoke('llm:getAvailableModels', provider),
  },

  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (settings: AppSettingsPatch): Promise<AppSettings> => ipcRenderer.invoke('settings:set', settings),
  },

  project: {
    list: (): Promise<{ projects: ProjectRecord[] }> => ipcRenderer.invoke('project:list'),
    add: (rootPath: string): Promise<{ success: boolean; project?: ProjectRecord; error?: string }> =>
      ipcRenderer.invoke('project:add', rootPath),
    remove: (projectId: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('project:remove', projectId),
    inputs: {
      list: (projectId: string): Promise<{ inputs: ProjectInputRecord[] }> => ipcRenderer.invoke('project:inputs:list', projectId),
      refresh: (projectId: string): Promise<{ inputs: ProjectInputRecord[] }> => ipcRenderer.invoke('project:inputs:refresh', projectId),
      import: (projectId: string): Promise<{ success: boolean; inputs: ProjectInputRecord[]; error?: string }> =>
        ipcRenderer.invoke('project:inputs:import', projectId),
    },
  },

  device: {
    list: (): Promise<unknown> => ipcRenderer.invoke('device:list'),
    refresh: (): Promise<unknown> => ipcRenderer.invoke('device:refresh'),
    activate: (deviceId: string): Promise<unknown> => ipcRenderer.invoke('device:activate', deviceId),
  },

  session: {
    list: (projectId?: string): Promise<{ sessions: SessionRecord[] }> => ipcRenderer.invoke('session:list', projectId),
    create: (projectId: string, title?: string): Promise<{ success: boolean; session?: SessionRecord; error?: string }> =>
      ipcRenderer.invoke('session:create', projectId, title),
    select: (id: string): Promise<unknown> => ipcRenderer.invoke('session:select', id),
  },

  run: {
    list: (sessionId: string): Promise<unknown> => ipcRenderer.invoke('run:list', sessionId),
  },

  capture: {
    open: (filePath?: string): Promise<unknown> => ipcRenderer.invoke('capture:open', filePath),
    list: (): Promise<unknown> => ipcRenderer.invoke('capture:list'),
    select: (captureId: string): Promise<unknown> => ipcRenderer.invoke('capture:select', captureId),
    openProjectInput: (
      request: { projectId: string; inputId: string; filePath: string; replayDeviceId: string },
    ): Promise<{ success: boolean; openedCapture?: OpenedCaptureState; contextSnapshot?: unknown; error?: string }> =>
      ipcRenderer.invoke('capture:openProjectInput', request),
    getOpenedState: (): Promise<OpenedCaptureState | null> => ipcRenderer.invoke('capture:getOpenedState'),
    clearOpenedState: (): Promise<{ success: boolean }> => ipcRenderer.invoke('capture:clearOpenedState'),
  },

  context: {
    get: (): Promise<unknown> => ipcRenderer.invoke('context:get'),
  },

  events: {
    onWorkflowStateChanged: (callback: (state: unknown) => void): void => {
      ipcRenderer.on('workflow:stateChanged', (_event, state) => callback(state));
    },
    onWorkflowStageChanged: (callback: (data: unknown) => void): void => {
      ipcRenderer.on('workflow:stageChanged', (_event, data) => callback(data));
    },
    onAgentMessage: (callback: (msg: unknown) => void): void => {
      ipcRenderer.on('agent:message', (_event, msg) => callback(msg));
    },
    onAgentStatusChanged: (callback: (state: unknown) => void): void => {
      ipcRenderer.on('agent:statusChanged', (_event, state) => callback(state));
    },
    onToolExecutionComplete: (callback: (trace: unknown) => void): void => {
      ipcRenderer.on('tool:executionComplete', (_event, trace) => callback(trace));
    },
    onEvidenceEventAdded: (callback: (event: unknown) => void): void => {
      ipcRenderer.on('evidence:eventAdded', (_event, event) => callback(event));
    },
    onDeviceStatusChanged: (callback: (status: unknown) => void): void => {
      ipcRenderer.on('device:statusChanged', (_event, status) => callback(status));
    },
    onCaptureStatusChanged: (callback: (status: unknown) => void): void => {
      ipcRenderer.on('capture:statusChanged', (_event, status) => callback(status));
    },
    onContextChanged: (callback: (snapshot: unknown) => void): void => {
      ipcRenderer.on('context:changed', (_event, snapshot) => callback(snapshot));
    },
    onProjectInputsChanged: (callback: (payload: { projectId: string; inputs: ProjectInputRecord[] }) => void): void => {
      ipcRenderer.on('project:inputsChanged', (_event, payload) => callback(payload));
    },
    onOpenedCaptureStateChanged: (callback: (state: OpenedCaptureState | null) => void): void => {
      ipcRenderer.on('capture:openedStateChanged', (_event, payload) => callback(payload));
    },
    onAppThemeChanged: (callback: (theme: 'dark' | 'light') => void): void => {
      ipcRenderer.on('app:themeChanged', (_event, theme) => callback(theme));
    },
    removeAllListeners: (channel: string): void => {
      ipcRenderer.removeAllListeners(channel);
    },
  },

  windowControls: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:toggleMaximize'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  },

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

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
