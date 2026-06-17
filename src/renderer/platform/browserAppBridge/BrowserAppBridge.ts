import type { ElectronAPI } from '@shared/types/electron';

const BRIDGE_MARKER = '__RDC_AGENT_BROWSER_APP_BRIDGE__';

type BrowserBridgeWindow = Window & {
  [BRIDGE_MARKER]?: true;
};

type EventCallback = (...args: unknown[]) => void;

function resolveBridgeOrigin(): string {
  const explicitOrigin = new URL(window.location.href).searchParams.get('rdcBridgeOrigin');
  return explicitOrigin || window.location.origin;
}

function detectPlatform(): NodeJS.Platform {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes('win')) return 'win32';
  if (platform.includes('mac')) return 'darwin';
  if (platform.includes('linux')) return 'linux';
  return 'browser' as NodeJS.Platform;
}

class BrowserAppBridgeClient {
  private readonly bridgeOrigin = resolveBridgeOrigin();
  private readonly listeners = new Map<string, Set<EventCallback>>();
  private eventSource: EventSource | null = null;
  private readonly platform = detectPlatform();

  readonly api: ElectronAPI = {
    platform: this.platform,
    isMac: this.platform === 'darwin',
    isWindows: this.platform === 'win32',
    isLinux: this.platform === 'linux',

    appMeta: {
      get: () => this.invoke('app:getMeta'),
    },
    appShell: {
      selectAvatar: () => this.invoke('app:selectAvatar'),
      getAvatarDataUrl: (avatarPath) => this.invoke('app:getAvatarDataUrl', avatarPath),
      openPath: (targetPath) => this.invoke('app:openPath', targetPath),
      copyText: (text) => this.invoke('app:copyText', text),
    },
    conversation: {
      sendMessage: (request) => this.invoke('conversation:sendMessage', request),
      cancelActiveTurn: (request) => this.invoke('conversation:cancelActiveTurn', request),
      answerUserInput: (request) => this.invoke('conversation:answerUserInput', request),
      answerToolApproval: (request) => this.invoke('conversation:answerToolApproval', request),
      getHistory: (sessionId) => this.invoke('conversation:getHistory', sessionId),
      clearHistory: (sessionId) => this.invoke('conversation:clearHistory', sessionId),
      undoLastTurn: (sessionId) => this.invoke('conversation:undoLastTurn', sessionId),
      compactHistory: (sessionId) => this.invoke('conversation:compactHistory', sessionId),
      onEvent: (callback) => { this.addListener('conversation:event', callback as EventCallback); },
      offEvent: (callback) => { this.removeListener('conversation:event', callback as EventCallback); },
    },
    selectFiles: () => this.invoke('dialog:selectFiles'),
    selectRdcFiles: () => this.invoke('dialog:selectRdcFiles'),
    selectDirectory: () => this.invoke('dialog:selectDirectory'),
    workflow: {
      getState: () => this.invoke('workflow:getState'),
      resume: (sessionId) => this.invoke('workflow:resume', sessionId),
      stop: (runId) => this.invoke('workflow:stop', runId),
      getRunUsage: (runId) => this.invoke('workflow:getRunUsage', runId),
      listRuns: () => this.invoke('workflow:listRuns'),
      listActiveRuns: () => this.invoke('workflow:listActiveRuns'),
    },
    agent: {
      sendMessage: (agentId, content) => this.invoke('agent:sendMessage', agentId, content),
      getState: (agentId) => this.invoke('agent:getState', agentId),
      getAllStates: () => this.invoke('agent:getAllStates'),
      configure: (agentId, config) => this.invoke('agent:configure', agentId, config),
    },
    command: {
      list: (category?) => this.invoke('command:list', category),
      execute: (request) => this.invoke('command:execute', request),
    },
    git: {
      getStatus: () => this.invoke('git:getStatus'),
      getDiff: (request) => this.invoke('git:getDiff', request),
      stage: (request) => this.invoke('git:stage', request),
      stageAll: () => this.invoke('git:stageAll'),
      unstage: (request) => this.invoke('git:unstage', request),
      unstageAll: () => this.invoke('git:unstageAll'),
      commit: (request) => this.invoke('git:commit', request),
    },
    tool: {
      getCatalog: () => this.invoke('tool:getCatalog'),
      getRuntimeSummary: () => this.invoke('tool:getRuntimeSummary'),
    },
    evidence: {
      getChain: () => this.invoke('evidence:getChain'),
      getEvents: (eventType) => this.invoke('evidence:getEvents', eventType),
    },
    llm: {
      configure: (config) => this.invoke('llm:configure', config),
      testConnection: (provider) => this.invoke('llm:testConnection', provider),
      getAvailableModels: (provider) => this.invoke('llm:getAvailableModels', provider),
      testProviderDraft: (request) => this.invoke('llm:testProviderDraft', request),
      connectProvider: (request) => this.invoke('llm:connectProvider', request),
      refreshProviderModels: (providerId) => this.invoke('llm:refreshProviderModels', providerId),
      disconnectProvider: (providerId) => this.invoke('llm:disconnectProvider', providerId),
      startProviderAccountLogin: (providerId) => this.invoke('llm:startProviderAccountLogin', providerId),
      getProviderAccountStatus: (providerId) => this.invoke('llm:getProviderAccountStatus', providerId),
      finishProviderAccountLogin: (request) => this.invoke('llm:finishProviderAccountLogin', request),
      logoutProviderAccount: (providerId) => this.invoke('llm:logoutProviderAccount', providerId),
    },
    settings: {
      get: () => this.invoke('settings:get'),
      getProviderSecret: (providerId) => this.invoke('settings:getProviderSecret', providerId),
      importAgentManifest: (filePath) => this.invoke('settings:importAgentManifest', filePath),
      set: (settings) => this.invoke('settings:set', settings),
    },
    project: {
      list: () => this.invoke('project:list'),
      add: (rootPath) => this.invoke('project:add', rootPath),
      select: (projectId) => this.invoke('project:select', projectId),
      rename: (projectId, newName) => this.invoke('project:rename', projectId, newName),
      remove: (projectId) => this.invoke('project:remove', projectId),
      inputs: {
        list: (projectId) => this.invoke('project:inputs:list', projectId),
        refresh: (projectId) => this.invoke('project:inputs:refresh', projectId),
        import: (projectId) => this.invoke('project:inputs:import', projectId),
        importPaths: (projectId, filePaths) => this.invoke('project:inputs:importPaths', projectId, filePaths),
      },
    },
    device: {
      list: () => this.invoke('device:list'),
      refresh: () => this.invoke('device:refresh'),
      activate: (deviceId) => this.invoke('device:activate', deviceId),
    },
    session: {
      list: (projectId) => this.invoke('session:list', projectId),
      create: (projectId, title) => this.invoke('session:create', projectId, title),
      rename: (id, title) => this.invoke('session:rename', id, title),
      remove: (id) => this.invoke('session:remove', id),
      select: (id) => this.invoke('session:select', id),
      attachments: {
        list: (sessionId) => this.invoke('session:attachments:list', sessionId),
        import: (sessionId, filePaths) => this.invoke('session:attachments:import', sessionId, filePaths),
      },
      outputs: {
        list: (sessionId, runId) => this.invoke('session:outputs:list', sessionId, runId),
      },
    },
    run: {
      list: (sessionId) => this.invoke('run:list', sessionId),
    },
    runtimeLog: {
      list: (request) => this.invoke('runtimeLog:list', request),
    },
    terminal: {
      listTabs: () => this.invoke('terminal:listTabs'),
      createTab: (request) => this.invoke('terminal:createTab', request),
      closeTab: (tabId) => this.invoke('terminal:closeTab', tabId),
      activateTab: (tabId) => this.invoke('terminal:activateTab', tabId),
      write: (tabId, data) => this.invoke('terminal:write', tabId, data),
      resize: (tabId, cols, rows) => this.invoke('terminal:resize', tabId, cols, rows),
    },
    capture: {
      list: () => this.invoke('capture:list'),
      select: (captureId) => this.invoke('capture:select', captureId),
      openProjectInput: (request) => this.invoke('capture:openProjectInput', request),
      getOpenedState: () => this.invoke('capture:getOpenedState'),
      clearOpenedState: () => this.invoke('capture:clearOpenedState'),
    },
    context: {
      get: () => this.invoke('context:get'),
      openHumanPreview: (request) => this.invoke('context:openHumanPreview', request),
      closeHumanPreview: () => this.invoke('context:closeHumanPreview'),
    },
    trace: {
      getRun: (runId) => this.invoke('trace:getRun', runId),
      getEvents: (runId, afterSeq) => this.invoke('trace:getEvents', runId, afterSeq),
      getProjection: (sessionId) => this.invoke('trace:getProjection', sessionId),
      exportRun: (runId) => this.invoke('trace:exportRun', runId),
      switchBranch: (sessionId, branchId) => this.invoke('trace:switchBranch', sessionId, branchId),
      exportSession: (sessionId, options) => this.invoke('trace:exportSession', sessionId, options),
    },
    events: {
      onWorkflowStateChanged: (callback) => this.subscribe('workflow:stateChanged', callback as EventCallback),
      onWorkflowStageChanged: (callback) => this.subscribe('workflow:stageChanged', callback as EventCallback),
      onRunStatusChanged: (callback) => this.subscribe('workflow:runStatusChanged', callback as EventCallback),
      onRunUsageChanged: (callback) => this.subscribe('workflow:runUsageChanged', callback as EventCallback),
      onTraceProjectionChanged: (callback) => this.subscribe('trace:projectionChanged', callback as EventCallback),
      onAgentMessage: (callback) => this.subscribe('agent:message', callback as EventCallback),
      onAgentStatusChanged: (callback) => this.subscribe('agent:statusChanged', callback as EventCallback),
      onToolExecutionComplete: (callback) => this.subscribe('tool:executionComplete', callback as EventCallback),
      onEvidenceEventAdded: (callback) => this.subscribe('evidence:eventAdded', callback as EventCallback),
      onDeviceStatusChanged: (callback) => this.subscribe('device:statusChanged', callback as EventCallback),
      onCaptureStatusChanged: (callback) => this.subscribe('capture:statusChanged', callback as EventCallback),
      onContextChanged: (callback) => this.subscribe('context:changed', callback as EventCallback),
      onProjectInputsChanged: (callback) => this.subscribe('project:inputsChanged', callback as EventCallback),
      onOpenedCaptureStateChanged: (callback) => this.subscribe('capture:openedStateChanged', callback as EventCallback),
      onRuntimeLogAppended: (callback) => this.subscribe('runtime:logAppended', callback as EventCallback),
      onTerminalData: (callback) => this.subscribe('terminal:data', callback as EventCallback),
      onTerminalExit: (callback) => this.subscribe('terminal:exit', callback as EventCallback),
      onTerminalTabsChanged: (callback) => this.subscribe('terminal:tabsChanged', callback as EventCallback),
      onAppThemeChanged: (callback) =>
        this.subscribe('app:themeChanged', callback as unknown as EventCallback),
      removeAllListeners: (channel) => {
        this.listeners.delete(channel);
      },
    },
    windowControls: {
      minimize: () => this.invoke('window:minimize'),
      toggleMaximize: () => this.invoke('window:toggleMaximize'),
      close: () => this.invoke('window:close'),
      isMaximized: () => this.invoke('window:isMaximized'),
    },
    on: (channel, callback) => {
      this.addListener(channel, callback);
    },
    off: (channel, callback) => {
      this.removeListener(channel, callback);
    },
  };

  private async invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
    const response = await fetch(`${this.bridgeOrigin}/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ channel, args }),
    });

    const payload = await response.json() as { success?: boolean; result?: T; error?: string };
    if (!response.ok || !payload.success) {
      throw new Error(payload.error || `Bridge invoke failed for ${channel}`);
    }
    return payload.result as T;
  }

  private subscribe(channel: string, callback: EventCallback): () => void {
    this.addListener(channel, callback);
    return () => this.removeListener(channel, callback);
  }

  private addListener(channel: string, callback: EventCallback): void {
    this.ensureEventSource();
    const channelListeners = this.listeners.get(channel) ?? new Set<EventCallback>();
    channelListeners.add(callback);
    this.listeners.set(channel, channelListeners);
  }

  private removeListener(channel: string, callback: EventCallback): void {
    const channelListeners = this.listeners.get(channel);
    if (!channelListeners) return;
    channelListeners.delete(callback);
    if (channelListeners.size === 0) {
      this.listeners.delete(channel);
    }
  }

  private ensureEventSource(): void {
    if (this.eventSource) return;
    this.eventSource = new EventSource(`${this.bridgeOrigin}/events`);
    this.eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data) as { channel: string; args?: unknown[] };
      const channelListeners = this.listeners.get(payload.channel);
      if (!channelListeners) return;
      for (const listener of channelListeners) {
        listener(...(payload.args ?? []));
      }
    };
  }
}

export function installBrowserAppBridge(): void {
  if (typeof window === 'undefined') return;

  const target = window as BrowserBridgeWindow;
  if (window.electronAPI || target[BRIDGE_MARKER]) {
    return;
  }

  const client = new BrowserAppBridgeClient();
  window.electronAPI = client.api;
  target[BRIDGE_MARKER] = true;
}

export function isBrowserAppBridge(): boolean {
  return Boolean((window as BrowserBridgeWindow)[BRIDGE_MARKER]);
}
