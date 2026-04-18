/**
 * Electron Preload Script
 */

import { contextBridge, ipcRenderer } from 'electron';
import type {
  ConversationMessage,
  ConversationSendRequest,
  ConversationStreamEvent,
  ConversationTurnResult,
} from '@shared/types/conversation';
import type { ElectronAPI } from '@shared/types/electron';
import type { AppSettings, AppSettingsPatch } from '@shared/types/settings';
import type {
  OpenedCaptureState,
  ProjectInputRecord,
  ProjectRecord,
  RunContextUsageSummary,
  SessionAttachmentRecord,
  SessionRecord,
} from '@shared/types/session';
import type { TerminalDataEvent, TerminalExitEvent, TerminalTabRecord } from '@shared/types/terminal';
import type { RuntimeLogEntry, RuntimeLogScope } from '@shared/types/runtimeLog';

const listenerMap = new Map<string, Map<(...args: unknown[]) => void, (...args: unknown[]) => void>>();

const validChannels = [
  'file:open',
  'case:new',
  'settings:open',
  'app:themeChanged',
  'workflow:stateChanged',
  'workflow:stageChanged',
  'workflow:runStatusChanged',
  'workflow:runUsageChanged',
  'workflow:blocked',
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
  'runtime:logAppended',
  'terminal:data',
  'terminal:exit',
  'terminal:tabsChanged',
  'conversation:event',
] as const;

const isValidChannel = (channel: string): channel is (typeof validChannels)[number] => {
  return validChannels.includes(channel as (typeof validChannels)[number]);
};

const registerTrackedListener = (channel: string, callback: (...args: unknown[]) => void) => {
  const wrappedCallback = (_event: unknown, ...args: unknown[]) => callback(...args);
  const channelListeners = listenerMap.get(channel) ?? new Map();
  channelListeners.set(callback, wrappedCallback);
  listenerMap.set(channel, channelListeners);
  ipcRenderer.on(channel, wrappedCallback);
};

const removeTrackedListener = (channel: string, callback: (...args: unknown[]) => void) => {
  const wrappedCallback = listenerMap.get(channel)?.get(callback);
  if (wrappedCallback) {
    ipcRenderer.removeListener(channel, wrappedCallback as Parameters<typeof ipcRenderer.removeListener>[1]);
    listenerMap.get(channel)?.delete(callback);
  }
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

  conversation: {
    sendMessage: (request: ConversationSendRequest): Promise<ConversationTurnResult> => ipcRenderer.invoke('conversation:sendMessage', request),
    getHistory: (sessionId: string): Promise<{ messages: ConversationMessage[] }> => ipcRenderer.invoke('conversation:getHistory', sessionId),
    onEvent: (callback: (event: ConversationStreamEvent) => void): void => {
      registerTrackedListener('conversation:event', (payload) => callback(payload as ConversationStreamEvent));
    },
    offEvent: (callback: (event: ConversationStreamEvent) => void): void => {
      removeTrackedListener('conversation:event', callback as unknown as (...args: unknown[]) => void);
    },
  },

  selectFiles: (): Promise<string[] | null> => ipcRenderer.invoke('dialog:selectFiles'),
  selectRdcFiles: (): Promise<string[] | null> => ipcRenderer.invoke('dialog:selectRdcFiles'),
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:selectDirectory'),

  workflow: {
    getState: (): Promise<unknown> => ipcRenderer.invoke('workflow:getState'),
    start: (request: unknown): Promise<unknown> => ipcRenderer.invoke('workflow:start', request),
    getPlan: (runId: string): Promise<unknown> => ipcRenderer.invoke('workflow:getPlan', runId),
    submitQuestions: (runId: string, answers: unknown[]): Promise<unknown> => ipcRenderer.invoke('workflow:submitQuestions', runId, answers),
    approvePlan: (runId: string): Promise<unknown> => ipcRenderer.invoke('workflow:approvePlan', runId),
    restartRun: (runId: string): Promise<unknown> => ipcRenderer.invoke('workflow:restartRun', runId),
    resume: (sessionId?: string): Promise<unknown> => ipcRenderer.invoke('workflow:resume', sessionId),
    stop: (runId?: string): Promise<unknown> => ipcRenderer.invoke('workflow:stop', runId),
    getRunUsage: (runId?: string): Promise<{ usage: RunContextUsageSummary | null }> => ipcRenderer.invoke('workflow:getRunUsage', runId),
    listRuns: (): Promise<unknown> => ipcRenderer.invoke('workflow:listRuns'),
    listActiveRuns: (): Promise<unknown> => ipcRenderer.invoke('workflow:listActiveRuns'),
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
    getProviderSecret: (providerId: string): Promise<string> => ipcRenderer.invoke('settings:getProviderSecret', providerId),
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
      importPaths: (projectId: string, filePaths: string[]): Promise<{ success: boolean; inputs: ProjectInputRecord[]; error?: string }> =>
        ipcRenderer.invoke('project:inputs:importPaths', projectId, filePaths),
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
    rename: (id: string, title: string): Promise<{ success: boolean; session?: SessionRecord; error?: string }> =>
      ipcRenderer.invoke('session:rename', id, title),
    remove: (id: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('session:remove', id),
    select: (id: string): Promise<unknown> => ipcRenderer.invoke('session:select', id),
    attachments: {
      list: (sessionId: string): Promise<{ attachments: SessionAttachmentRecord[] }> =>
        ipcRenderer.invoke('session:attachments:list', sessionId),
      import: (sessionId: string, filePaths: string[]): Promise<{ success: boolean; attachments: SessionAttachmentRecord[]; error?: string }> =>
        ipcRenderer.invoke('session:attachments:import', sessionId, filePaths),
    },
  },

  run: {
    list: (sessionId: string): Promise<unknown> => ipcRenderer.invoke('run:list', sessionId),
  },

  runtimeLog: {
    list: (request: { scope: RuntimeLogScope; sessionId?: string | null }): Promise<{ entries: RuntimeLogEntry[] }> =>
      ipcRenderer.invoke('runtimeLog:list', request),
  },

  terminal: {
    listTabs: (): Promise<{ tabs: TerminalTabRecord[] }> => ipcRenderer.invoke('terminal:listTabs'),
    createTab: (request?: { cwd?: string | null }): Promise<{ success: boolean; tab?: TerminalTabRecord; tabs: TerminalTabRecord[]; error?: string }> =>
      ipcRenderer.invoke('terminal:createTab', request),
    closeTab: (tabId: string): Promise<{ success: boolean; tabs: TerminalTabRecord[]; error?: string }> =>
      ipcRenderer.invoke('terminal:closeTab', tabId),
    activateTab: (tabId: string): Promise<{ success: boolean; tabs: TerminalTabRecord[]; error?: string }> =>
      ipcRenderer.invoke('terminal:activateTab', tabId),
    write: (tabId: string, data: string): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('terminal:write', tabId, data),
    resize: (tabId: string, cols: number, rows: number): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('terminal:resize', tabId, cols, rows),
  },

  capture: {
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
    onRunStatusChanged: (callback: (data: unknown) => void): void => {
      ipcRenderer.on('workflow:runStatusChanged', (_event, data) => callback(data));
    },
    onRunUsageChanged: (callback: (summary: RunContextUsageSummary) => void): void => {
      ipcRenderer.on('workflow:runUsageChanged', (_event, summary) => callback(summary));
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
    onRuntimeLogAppended: (callback: (entry: RuntimeLogEntry) => void): void => {
      ipcRenderer.on('runtime:logAppended', (_event, payload) => callback(payload));
    },
    onTerminalData: (callback: (event: TerminalDataEvent) => void): void => {
      ipcRenderer.on('terminal:data', (_event, payload) => callback(payload));
    },
    onTerminalExit: (callback: (event: TerminalExitEvent) => void): void => {
      ipcRenderer.on('terminal:exit', (_event, payload) => callback(payload));
    },
    onTerminalTabsChanged: (callback: (payload: { tabs: TerminalTabRecord[] }) => void): void => {
      ipcRenderer.on('terminal:tabsChanged', (_event, payload) => callback(payload));
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
      registerTrackedListener(channel, callback);
    }
  },

  off: (channel: string, callback: (...args: unknown[]) => void) => {
    removeTrackedListener(channel, callback);
  },
} as ElectronAPI;

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
