"use strict";
const electron = require("electron");
const listenerMap = /* @__PURE__ */ new Map();
const validChannels = [
  "file:open",
  "case:new",
  "settings:open",
  "workflow:stateChanged",
  "workflow:stageChanged",
  "agent:message",
  "agent:statusChanged",
  "tool:executionComplete",
  "evidence:eventAdded",
  "llm:stream",
  "window:maximized-changed",
  "device:statusChanged",
  "capture:statusChanged",
  "context:changed"
];
const isValidChannel = (channel) => {
  return validChannels.includes(channel);
};
const electronAPI = {
  platform: process.platform,
  isMac: process.platform === "darwin",
  isWindows: process.platform === "win32",
  isLinux: process.platform === "linux",
  appMeta: {
    get: () => electron.ipcRenderer.invoke("app:getMeta")
  },
  selectRdcFiles: () => electron.ipcRenderer.invoke("dialog:selectRdcFiles"),
  selectDirectory: () => electron.ipcRenderer.invoke("dialog:selectDirectory"),
  workflow: {
    getState: () => electron.ipcRenderer.invoke("workflow:getState"),
    start: (request) => electron.ipcRenderer.invoke("workflow:start", request),
    resume: (sessionId) => electron.ipcRenderer.invoke("workflow:resume", sessionId),
    listRuns: () => electron.ipcRenderer.invoke("workflow:listRuns"),
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
    set: (settings) => electron.ipcRenderer.invoke("settings:set", settings)
  },
  device: {
    list: () => electron.ipcRenderer.invoke("device:list"),
    refresh: () => electron.ipcRenderer.invoke("device:refresh"),
    activate: (deviceId) => electron.ipcRenderer.invoke("device:activate", deviceId)
  },
  session: {
    list: () => electron.ipcRenderer.invoke("session:list"),
    select: (id) => electron.ipcRenderer.invoke("session:select", id)
  },
  capture: {
    open: (filePath) => electron.ipcRenderer.invoke("capture:open", filePath),
    list: () => electron.ipcRenderer.invoke("capture:list"),
    select: (captureId) => electron.ipcRenderer.invoke("capture:select", captureId)
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
      const wrappedCallback = (_event, ...args) => callback(...args);
      const channelListeners = listenerMap.get(channel) ?? /* @__PURE__ */ new Map();
      channelListeners.set(callback, wrappedCallback);
      listenerMap.set(channel, channelListeners);
      electron.ipcRenderer.on(channel, wrappedCallback);
    }
  },
  off: (channel, callback) => {
    const wrappedCallback = listenerMap.get(channel)?.get(callback);
    if (wrappedCallback) {
      electron.ipcRenderer.removeListener(channel, wrappedCallback);
      listenerMap.get(channel)?.delete(callback);
    }
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
