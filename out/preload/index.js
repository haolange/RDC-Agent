"use strict";
const electron = require("electron");
const listenerMap = /* @__PURE__ */ new Map();
const validChannels = [
  "file:open",
  "case:new",
  "settings:open",
  "app:themeChanged",
  "workflow:stateChanged",
  "workflow:stageChanged",
  "workflow:runStatusChanged",
  "workflow:runUsageChanged",
  "workflow:blocked",
  "agent:message",
  "agent:statusChanged",
  "tool:executionComplete",
  "evidence:eventAdded",
  "llm:stream",
  "window:maximized-changed",
  "device:statusChanged",
  "capture:statusChanged",
  "context:changed",
  "project:inputsChanged",
  "capture:openedStateChanged",
  "runtime:logAppended",
  "terminal:data",
  "terminal:exit",
  "terminal:tabsChanged",
  "conversation:event"
];
const isValidChannel = (channel) => {
  return validChannels.includes(channel);
};
const registerTrackedListener = (channel, callback) => {
  const wrappedCallback = (_event, ...args) => callback(...args);
  const channelListeners = listenerMap.get(channel) ?? /* @__PURE__ */ new Map();
  channelListeners.set(callback, wrappedCallback);
  listenerMap.set(channel, channelListeners);
  electron.ipcRenderer.on(channel, wrappedCallback);
};
const removeTrackedListener = (channel, callback) => {
  const wrappedCallback = listenerMap.get(channel)?.get(callback);
  if (wrappedCallback) {
    electron.ipcRenderer.removeListener(channel, wrappedCallback);
    listenerMap.get(channel)?.delete(callback);
  }
};
const electronAPI = {
  platform: process.platform,
  isMac: process.platform === "darwin",
  isWindows: process.platform === "win32",
  isLinux: process.platform === "linux",
  appMeta: {
    get: () => electron.ipcRenderer.invoke("app:getMeta")
  },
  appShell: {
    selectAvatar: () => electron.ipcRenderer.invoke("app:selectAvatar"),
    openPath: (targetPath) => electron.ipcRenderer.invoke("app:openPath", targetPath),
    copyText: (text) => electron.ipcRenderer.invoke("app:copyText", text)
  },
  conversation: {
    sendMessage: (request) => electron.ipcRenderer.invoke("conversation:sendMessage", request),
    getHistory: (sessionId) => electron.ipcRenderer.invoke("conversation:getHistory", sessionId),
    onEvent: (callback) => {
      registerTrackedListener("conversation:event", (payload) => callback(payload));
    },
    offEvent: (callback) => {
      removeTrackedListener("conversation:event", callback);
    }
  },
  selectFiles: () => electron.ipcRenderer.invoke("dialog:selectFiles"),
  selectRdcFiles: () => electron.ipcRenderer.invoke("dialog:selectRdcFiles"),
  selectDirectory: () => electron.ipcRenderer.invoke("dialog:selectDirectory"),
  workflow: {
    getState: () => electron.ipcRenderer.invoke("workflow:getState"),
    start: (request) => electron.ipcRenderer.invoke("workflow:start", request),
    getPlan: (runId) => electron.ipcRenderer.invoke("workflow:getPlan", runId),
    submitQuestions: (runId, answers) => electron.ipcRenderer.invoke("workflow:submitQuestions", runId, answers),
    approvePlan: (runId) => electron.ipcRenderer.invoke("workflow:approvePlan", runId),
    restartRun: (runId) => electron.ipcRenderer.invoke("workflow:restartRun", runId),
    resume: (sessionId) => electron.ipcRenderer.invoke("workflow:resume", sessionId),
    stop: (runId) => electron.ipcRenderer.invoke("workflow:stop", runId),
    getRunUsage: (runId) => electron.ipcRenderer.invoke("workflow:getRunUsage", runId),
    listRuns: () => electron.ipcRenderer.invoke("workflow:listRuns"),
    listActiveRuns: () => electron.ipcRenderer.invoke("workflow:listActiveRuns"),
    advanceStage: () => electron.ipcRenderer.invoke("workflow:advanceStage"),
    backtrack: (reason, trigger) => electron.ipcRenderer.invoke("workflow:backtrack", reason, trigger),
    dispatchSpecialist: (agentId, objective) => electron.ipcRenderer.invoke("workflow:dispatchSpecialist", agentId, objective)
  },
  agent: {
    sendMessage: (agentId, content) => electron.ipcRenderer.invoke("agent:sendMessage", agentId, content),
    getState: (agentId) => electron.ipcRenderer.invoke("agent:getState", agentId),
    getAllStates: () => electron.ipcRenderer.invoke("agent:getAllStates"),
    configure: (agentId, config) => electron.ipcRenderer.invoke("agent:configure", agentId, config)
  },
  tool: {
    getCatalog: () => electron.ipcRenderer.invoke("tool:getCatalog"),
    execute: (toolName, args) => electron.ipcRenderer.invoke("tool:execute", toolName, args)
  },
  evidence: {
    getChain: () => electron.ipcRenderer.invoke("evidence:getChain"),
    getEvents: (eventType) => electron.ipcRenderer.invoke("evidence:getEvents", eventType)
  },
  llm: {
    configure: (config) => electron.ipcRenderer.invoke("llm:configure", config),
    testConnection: (provider) => electron.ipcRenderer.invoke("llm:testConnection", provider),
    getAvailableModels: (provider) => electron.ipcRenderer.invoke("llm:getAvailableModels", provider)
  },
  settings: {
    get: () => electron.ipcRenderer.invoke("settings:get"),
    getProviderSecret: (providerId) => electron.ipcRenderer.invoke("settings:getProviderSecret", providerId),
    set: (settings) => electron.ipcRenderer.invoke("settings:set", settings)
  },
  project: {
    list: () => electron.ipcRenderer.invoke("project:list"),
    add: (rootPath) => electron.ipcRenderer.invoke("project:add", rootPath),
    remove: (projectId) => electron.ipcRenderer.invoke("project:remove", projectId),
    inputs: {
      list: (projectId) => electron.ipcRenderer.invoke("project:inputs:list", projectId),
      refresh: (projectId) => electron.ipcRenderer.invoke("project:inputs:refresh", projectId),
      import: (projectId) => electron.ipcRenderer.invoke("project:inputs:import", projectId),
      importPaths: (projectId, filePaths) => electron.ipcRenderer.invoke("project:inputs:importPaths", projectId, filePaths)
    }
  },
  device: {
    list: () => electron.ipcRenderer.invoke("device:list"),
    refresh: () => electron.ipcRenderer.invoke("device:refresh"),
    activate: (deviceId) => electron.ipcRenderer.invoke("device:activate", deviceId)
  },
  session: {
    list: (projectId) => electron.ipcRenderer.invoke("session:list", projectId),
    create: (projectId, title) => electron.ipcRenderer.invoke("session:create", projectId, title),
    rename: (id, title) => electron.ipcRenderer.invoke("session:rename", id, title),
    remove: (id) => electron.ipcRenderer.invoke("session:remove", id),
    select: (id) => electron.ipcRenderer.invoke("session:select", id),
    attachments: {
      list: (sessionId) => electron.ipcRenderer.invoke("session:attachments:list", sessionId),
      import: (sessionId, filePaths) => electron.ipcRenderer.invoke("session:attachments:import", sessionId, filePaths)
    }
  },
  run: {
    list: (sessionId) => electron.ipcRenderer.invoke("run:list", sessionId)
  },
  runtimeLog: {
    list: (request) => electron.ipcRenderer.invoke("runtimeLog:list", request)
  },
  terminal: {
    listTabs: () => electron.ipcRenderer.invoke("terminal:listTabs"),
    createTab: (request) => electron.ipcRenderer.invoke("terminal:createTab", request),
    closeTab: (tabId) => electron.ipcRenderer.invoke("terminal:closeTab", tabId),
    activateTab: (tabId) => electron.ipcRenderer.invoke("terminal:activateTab", tabId),
    write: (tabId, data) => electron.ipcRenderer.invoke("terminal:write", tabId, data),
    resize: (tabId, cols, rows) => electron.ipcRenderer.invoke("terminal:resize", tabId, cols, rows)
  },
  capture: {
    list: () => electron.ipcRenderer.invoke("capture:list"),
    select: (captureId) => electron.ipcRenderer.invoke("capture:select", captureId),
    openProjectInput: (request) => electron.ipcRenderer.invoke("capture:openProjectInput", request),
    getOpenedState: () => electron.ipcRenderer.invoke("capture:getOpenedState"),
    clearOpenedState: () => electron.ipcRenderer.invoke("capture:clearOpenedState")
  },
  context: {
    get: () => electron.ipcRenderer.invoke("context:get")
  },
  events: {
    onWorkflowStateChanged: (callback) => {
      electron.ipcRenderer.on("workflow:stateChanged", (_event, state) => callback(state));
    },
    onWorkflowStageChanged: (callback) => {
      electron.ipcRenderer.on("workflow:stageChanged", (_event, data) => callback(data));
    },
    onRunStatusChanged: (callback) => {
      electron.ipcRenderer.on("workflow:runStatusChanged", (_event, data) => callback(data));
    },
    onRunUsageChanged: (callback) => {
      electron.ipcRenderer.on("workflow:runUsageChanged", (_event, summary) => callback(summary));
    },
    onAgentMessage: (callback) => {
      electron.ipcRenderer.on("agent:message", (_event, msg) => callback(msg));
    },
    onAgentStatusChanged: (callback) => {
      electron.ipcRenderer.on("agent:statusChanged", (_event, state) => callback(state));
    },
    onToolExecutionComplete: (callback) => {
      electron.ipcRenderer.on("tool:executionComplete", (_event, trace) => callback(trace));
    },
    onEvidenceEventAdded: (callback) => {
      electron.ipcRenderer.on("evidence:eventAdded", (_event, event) => callback(event));
    },
    onDeviceStatusChanged: (callback) => {
      electron.ipcRenderer.on("device:statusChanged", (_event, status) => callback(status));
    },
    onCaptureStatusChanged: (callback) => {
      electron.ipcRenderer.on("capture:statusChanged", (_event, status) => callback(status));
    },
    onContextChanged: (callback) => {
      electron.ipcRenderer.on("context:changed", (_event, snapshot) => callback(snapshot));
    },
    onProjectInputsChanged: (callback) => {
      electron.ipcRenderer.on("project:inputsChanged", (_event, payload) => callback(payload));
    },
    onOpenedCaptureStateChanged: (callback) => {
      electron.ipcRenderer.on("capture:openedStateChanged", (_event, payload) => callback(payload));
    },
    onRuntimeLogAppended: (callback) => {
      electron.ipcRenderer.on("runtime:logAppended", (_event, payload) => callback(payload));
    },
    onTerminalData: (callback) => {
      electron.ipcRenderer.on("terminal:data", (_event, payload) => callback(payload));
    },
    onTerminalExit: (callback) => {
      electron.ipcRenderer.on("terminal:exit", (_event, payload) => callback(payload));
    },
    onTerminalTabsChanged: (callback) => {
      electron.ipcRenderer.on("terminal:tabsChanged", (_event, payload) => callback(payload));
    },
    onAppThemeChanged: (callback) => {
      electron.ipcRenderer.on("app:themeChanged", (_event, theme) => callback(theme));
    },
    removeAllListeners: (channel) => {
      electron.ipcRenderer.removeAllListeners(channel);
    }
  },
  windowControls: {
    minimize: () => electron.ipcRenderer.invoke("window:minimize"),
    toggleMaximize: () => electron.ipcRenderer.invoke("window:toggleMaximize"),
    close: () => electron.ipcRenderer.invoke("window:close"),
    isMaximized: () => electron.ipcRenderer.invoke("window:isMaximized")
  },
  on: (channel, callback) => {
    if (isValidChannel(channel)) {
      registerTrackedListener(channel, callback);
    }
  },
  off: (channel, callback) => {
    removeTrackedListener(channel, callback);
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
