"use strict";
const electron = require("electron");
const PRELOAD_EVENT_CHANNELS = [
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
const isPreloadEventChannel = (channel) => {
  return PRELOAD_EVENT_CHANNELS.includes(channel);
};
const createAgentApi = () => ({
  sendMessage: (agentId, content) => electron.ipcRenderer.invoke("agent:sendMessage", agentId, content),
  getState: (agentId) => electron.ipcRenderer.invoke("agent:getState", agentId),
  getAllStates: () => electron.ipcRenderer.invoke("agent:getAllStates"),
  configure: (agentId, config) => electron.ipcRenderer.invoke("agent:configure", agentId, config)
});
const createDeviceApi = () => ({
  list: () => electron.ipcRenderer.invoke("device:list"),
  refresh: () => electron.ipcRenderer.invoke("device:refresh"),
  activate: (deviceId) => electron.ipcRenderer.invoke("device:activate", deviceId)
});
const createCaptureApi = () => ({
  list: () => electron.ipcRenderer.invoke("capture:list"),
  select: (captureId) => electron.ipcRenderer.invoke("capture:select", captureId),
  openProjectInput: (request) => electron.ipcRenderer.invoke("capture:openProjectInput", request),
  getOpenedState: () => electron.ipcRenderer.invoke("capture:getOpenedState"),
  clearOpenedState: () => electron.ipcRenderer.invoke("capture:clearOpenedState")
});
const createContextApi = () => ({
  get: () => electron.ipcRenderer.invoke("context:get"),
  openHumanPreview: (request) => electron.ipcRenderer.invoke("context:openHumanPreview", request),
  closeHumanPreview: () => electron.ipcRenderer.invoke("context:closeHumanPreview")
});
const listenerMap = /* @__PURE__ */ new Map();
const registerTrackedListener = (channel, callback) => {
  const wrappedCallback = (_event, ...args) => callback(...args);
  const channelListeners = listenerMap.get(channel) ?? /* @__PURE__ */ new Map();
  channelListeners.set(callback, wrappedCallback);
  listenerMap.set(channel, channelListeners);
  electron.ipcRenderer.on(channel, wrappedCallback);
  return () => removeTrackedListener(channel, callback);
};
const removeTrackedListener = (channel, callback) => {
  const wrappedCallback = listenerMap.get(channel)?.get(callback);
  if (wrappedCallback) {
    electron.ipcRenderer.removeListener(channel, wrappedCallback);
    listenerMap.get(channel)?.delete(callback);
  }
};
const removeAllTrackedListeners = (channel) => {
  electron.ipcRenderer.removeAllListeners(channel);
};
const createConversationApi = () => ({
  sendMessage: (request) => electron.ipcRenderer.invoke("conversation:sendMessage", request),
  cancelActiveTurn: (request) => electron.ipcRenderer.invoke("conversation:cancelActiveTurn", request),
  getHistory: (sessionId) => electron.ipcRenderer.invoke("conversation:getHistory", sessionId),
  onEvent: (callback) => {
    registerTrackedListener("conversation:event", (payload) => callback(payload));
  },
  offEvent: (callback) => {
    removeTrackedListener("conversation:event", callback);
  }
});
const createEventSubscriptionApi = () => ({
  onWorkflowStateChanged: (callback) => registerTrackedListener("workflow:stateChanged", (state) => callback(state)),
  onWorkflowStageChanged: (callback) => registerTrackedListener("workflow:stageChanged", (data) => callback(data)),
  onRunStatusChanged: (callback) => registerTrackedListener("workflow:runStatusChanged", (data) => callback(data)),
  onRunUsageChanged: (callback) => registerTrackedListener("workflow:runUsageChanged", (summary) => callback(summary)),
  onTraceProjectionChanged: (callback) => registerTrackedListener(
    "trace:projectionChanged",
    (payload) => callback(payload)
  ),
  onAgentMessage: (callback) => registerTrackedListener("agent:message", (msg) => callback(msg)),
  onAgentStatusChanged: (callback) => registerTrackedListener("agent:statusChanged", (state) => callback(state)),
  onToolExecutionComplete: (callback) => registerTrackedListener("tool:executionComplete", (trace) => callback(trace)),
  onEvidenceEventAdded: (callback) => registerTrackedListener("evidence:eventAdded", (event) => callback(event)),
  onDeviceStatusChanged: (callback) => registerTrackedListener("device:statusChanged", (status) => callback(status)),
  onCaptureStatusChanged: (callback) => registerTrackedListener("capture:statusChanged", (status) => callback(status)),
  onContextChanged: (callback) => registerTrackedListener("context:changed", (snapshot) => callback(snapshot)),
  onProjectInputsChanged: (callback) => registerTrackedListener(
    "project:inputsChanged",
    (payload) => callback(payload)
  ),
  onOpenedCaptureStateChanged: (callback) => registerTrackedListener("capture:openedStateChanged", (payload) => callback(payload)),
  onRuntimeLogAppended: (callback) => registerTrackedListener("runtime:logAppended", (payload) => callback(payload)),
  onTerminalData: (callback) => registerTrackedListener("terminal:data", (payload) => callback(payload)),
  onTerminalExit: (callback) => registerTrackedListener("terminal:exit", (payload) => callback(payload)),
  onTerminalTabsChanged: (callback) => registerTrackedListener("terminal:tabsChanged", (payload) => callback(payload)),
  onAppThemeChanged: (callback) => registerTrackedListener("app:themeChanged", (theme) => callback(theme)),
  removeAllListeners: (channel) => {
    removeAllTrackedListeners(channel);
  }
});
const createProjectApi = () => ({
  list: () => electron.ipcRenderer.invoke("project:list"),
  add: (rootPath) => electron.ipcRenderer.invoke("project:add", rootPath),
  select: (projectId) => electron.ipcRenderer.invoke("project:select", projectId),
  rename: (projectId, newName) => electron.ipcRenderer.invoke("project:rename", projectId, newName),
  remove: (projectId) => electron.ipcRenderer.invoke("project:remove", projectId),
  inputs: {
    list: (projectId) => electron.ipcRenderer.invoke("project:inputs:list", projectId),
    refresh: (projectId) => electron.ipcRenderer.invoke("project:inputs:refresh", projectId),
    import: (projectId) => electron.ipcRenderer.invoke("project:inputs:import", projectId),
    importPaths: (projectId, filePaths) => electron.ipcRenderer.invoke("project:inputs:importPaths", projectId, filePaths)
  }
});
const createSessionApi = () => ({
  list: (projectId) => electron.ipcRenderer.invoke("session:list", projectId),
  create: (projectId, title) => electron.ipcRenderer.invoke("session:create", projectId, title),
  rename: (id, title) => electron.ipcRenderer.invoke("session:rename", id, title),
  remove: (id) => electron.ipcRenderer.invoke("session:remove", id),
  select: (id) => electron.ipcRenderer.invoke("session:select", id),
  attachments: {
    list: (sessionId) => electron.ipcRenderer.invoke("session:attachments:list", sessionId),
    import: (sessionId, filePaths) => electron.ipcRenderer.invoke("session:attachments:import", sessionId, filePaths)
  },
  outputs: {
    list: (sessionId, runId) => electron.ipcRenderer.invoke("session:outputs:list", sessionId, runId)
  }
});
const createRunApi = () => ({
  list: (sessionId) => electron.ipcRenderer.invoke("run:list", sessionId)
});
const createRuntimeLogApi = () => ({
  list: (request) => electron.ipcRenderer.invoke("runtimeLog:list", request)
});
const createTerminalApi = () => ({
  listTabs: () => electron.ipcRenderer.invoke("terminal:listTabs"),
  createTab: (request) => electron.ipcRenderer.invoke("terminal:createTab", request),
  closeTab: (tabId) => electron.ipcRenderer.invoke("terminal:closeTab", tabId),
  activateTab: (tabId) => electron.ipcRenderer.invoke("terminal:activateTab", tabId),
  write: (tabId, data) => electron.ipcRenderer.invoke("terminal:write", tabId, data),
  resize: (tabId, cols, rows) => electron.ipcRenderer.invoke("terminal:resize", tabId, cols, rows)
});
const createLlmApi = () => ({
  configure: (config) => electron.ipcRenderer.invoke("llm:configure", config),
  testConnection: (provider) => electron.ipcRenderer.invoke("llm:testConnection", provider),
  getAvailableModels: (provider) => electron.ipcRenderer.invoke("llm:getAvailableModels", provider),
  testProviderDraft: (request) => electron.ipcRenderer.invoke("llm:testProviderDraft", request),
  connectProvider: (request) => electron.ipcRenderer.invoke("llm:connectProvider", request),
  refreshProviderModels: (providerId) => electron.ipcRenderer.invoke("llm:refreshProviderModels", providerId),
  disconnectProvider: (providerId) => electron.ipcRenderer.invoke("llm:disconnectProvider", providerId),
  startProviderAccountLogin: (providerId) => electron.ipcRenderer.invoke("llm:startProviderAccountLogin", providerId),
  getProviderAccountStatus: (providerId) => electron.ipcRenderer.invoke("llm:getProviderAccountStatus", providerId),
  finishProviderAccountLogin: (request) => electron.ipcRenderer.invoke("llm:finishProviderAccountLogin", request),
  logoutProviderAccount: (providerId) => electron.ipcRenderer.invoke("llm:logoutProviderAccount", providerId)
});
const createSettingsApi = () => ({
  get: () => electron.ipcRenderer.invoke("settings:get"),
  getProviderSecret: (providerId) => electron.ipcRenderer.invoke("settings:getProviderSecret", providerId),
  set: (settings) => electron.ipcRenderer.invoke("settings:set", settings)
});
const createAppMetaApi = () => ({
  get: () => electron.ipcRenderer.invoke("app:getMeta")
});
const createAppShellApi = () => ({
  selectAvatar: () => electron.ipcRenderer.invoke("app:selectAvatar"),
  getAvatarDataUrl: (avatarPath) => electron.ipcRenderer.invoke("app:getAvatarDataUrl", avatarPath),
  openPath: (targetPath) => electron.ipcRenderer.invoke("app:openPath", targetPath),
  copyText: (text) => electron.ipcRenderer.invoke("app:copyText", text)
});
const createDialogApi = () => ({
  selectFiles: () => electron.ipcRenderer.invoke("dialog:selectFiles"),
  selectRdcFiles: () => electron.ipcRenderer.invoke("dialog:selectRdcFiles"),
  selectDirectory: () => electron.ipcRenderer.invoke("dialog:selectDirectory")
});
const createWindowControlsApi = () => ({
  minimize: () => electron.ipcRenderer.invoke("window:minimize"),
  toggleMaximize: () => electron.ipcRenderer.invoke("window:toggleMaximize"),
  close: () => electron.ipcRenderer.invoke("window:close"),
  isMaximized: () => electron.ipcRenderer.invoke("window:isMaximized")
});
const createToolApi = () => ({
  getCatalog: () => electron.ipcRenderer.invoke("tool:getCatalog"),
  getRuntimeSummary: () => electron.ipcRenderer.invoke("tool:getRuntimeSummary"),
  execute: (toolName, args) => electron.ipcRenderer.invoke("tool:execute", toolName, args)
});
const createEvidenceApi = () => ({
  getChain: () => electron.ipcRenderer.invoke("evidence:getChain"),
  getEvents: (eventType) => electron.ipcRenderer.invoke("evidence:getEvents", eventType)
});
const createWorkflowApi = () => ({
  getState: () => electron.ipcRenderer.invoke("workflow:getState"),
  start: (request) => electron.ipcRenderer.invoke("workflow:start", request),
  getPlan: (runId) => electron.ipcRenderer.invoke("workflow:getPlan", runId),
  submitQuestions: (runId, answers) => electron.ipcRenderer.invoke("workflow:submitQuestions", runId, answers),
  approvePlan: (runId) => electron.ipcRenderer.invoke("workflow:approvePlan", runId),
  getWorkstreamSession: (sessionId) => electron.ipcRenderer.invoke("workflow:getWorkstreamSession", sessionId),
  requestPlanRevision: (runId, revisionText) => electron.ipcRenderer.invoke("workflow:requestPlanRevision", runId, revisionText),
  switchWorkstreamBranch: (sessionId, branchId) => electron.ipcRenderer.invoke("workflow:switchWorkstreamBranch", sessionId, branchId),
  exportWorkstreamSession: (sessionId, options) => electron.ipcRenderer.invoke("workflow:exportWorkstreamSession", sessionId, options),
  restartRun: (runId) => electron.ipcRenderer.invoke("workflow:restartRun", runId),
  resume: (sessionId) => electron.ipcRenderer.invoke("workflow:resume", sessionId),
  stop: (runId) => electron.ipcRenderer.invoke("workflow:stop", runId),
  getRunUsage: (runId) => electron.ipcRenderer.invoke("workflow:getRunUsage", runId),
  listRuns: () => electron.ipcRenderer.invoke("workflow:listRuns"),
  listActiveRuns: () => electron.ipcRenderer.invoke("workflow:listActiveRuns")
});
const createTraceApi = () => ({
  getRun: (runId) => electron.ipcRenderer.invoke("trace:getRun", runId),
  getEvents: (runId, afterSeq) => electron.ipcRenderer.invoke("trace:getEvents", runId, afterSeq),
  getProjection: (sessionId) => electron.ipcRenderer.invoke("trace:getProjection", sessionId),
  exportRun: (runId) => electron.ipcRenderer.invoke("trace:exportRun", runId)
});
const dialogApi = createDialogApi();
const electronAPI = {
  platform: process.platform,
  isMac: process.platform === "darwin",
  isWindows: process.platform === "win32",
  isLinux: process.platform === "linux",
  appMeta: createAppMetaApi(),
  appShell: createAppShellApi(),
  conversation: createConversationApi(),
  selectFiles: dialogApi.selectFiles,
  selectRdcFiles: dialogApi.selectRdcFiles,
  selectDirectory: dialogApi.selectDirectory,
  workflow: createWorkflowApi(),
  trace: createTraceApi(),
  agent: createAgentApi(),
  tool: createToolApi(),
  evidence: createEvidenceApi(),
  llm: createLlmApi(),
  settings: createSettingsApi(),
  project: createProjectApi(),
  device: createDeviceApi(),
  session: createSessionApi(),
  run: createRunApi(),
  runtimeLog: createRuntimeLogApi(),
  terminal: createTerminalApi(),
  capture: createCaptureApi(),
  context: createContextApi(),
  events: createEventSubscriptionApi(),
  windowControls: createWindowControlsApi(),
  on: (channel, callback) => {
    if (isPreloadEventChannel(channel)) {
      registerTrackedListener(channel, callback);
    }
  },
  off: (channel, callback) => {
    removeTrackedListener(channel, callback);
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
