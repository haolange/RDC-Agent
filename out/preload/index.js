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
  "window:maximized-changed"
];
const isValidChannel = (channel) => {
  return validChannels.includes(channel);
};
const electronAPI = {
  // 平台信息
  platform: process.platform,
  isMac: process.platform === "darwin",
  isWindows: process.platform === "win32",
  isLinux: process.platform === "linux",
  appMeta: {
    get: () => {
      return electron.ipcRenderer.invoke("app:getMeta");
    }
  },
  // 文件操作
  selectRdcFiles: () => {
    return electron.ipcRenderer.invoke("dialog:selectRdcFiles");
  },
  selectDirectory: () => {
    return electron.ipcRenderer.invoke("dialog:selectDirectory");
  },
  // 工作流操作
  workflow: {
    getState: () => {
      return electron.ipcRenderer.invoke("workflow:getState");
    },
    start: (capturePaths, userGoal) => {
      return electron.ipcRenderer.invoke("workflow:start", capturePaths, userGoal);
    },
    advanceStage: () => {
      return electron.ipcRenderer.invoke("workflow:advanceStage");
    },
    backtrack: (reason, trigger) => {
      return electron.ipcRenderer.invoke("workflow:backtrack", reason, trigger);
    },
    dispatchSpecialist: (agentId, objective) => {
      return electron.ipcRenderer.invoke("workflow:dispatchSpecialist", agentId, objective);
    }
  },
  // Agent操作
  agent: {
    sendMessage: (agentId, content) => {
      return electron.ipcRenderer.invoke("agent:sendMessage", agentId, content);
    },
    getState: (agentId) => {
      return electron.ipcRenderer.invoke("agent:getState", agentId);
    },
    getAllStates: () => {
      return electron.ipcRenderer.invoke("agent:getAllStates");
    },
    configure: (agentId, config) => {
      return electron.ipcRenderer.invoke("agent:configure", agentId, config);
    }
  },
  // 工具操作
  tool: {
    getCatalog: () => {
      return electron.ipcRenderer.invoke("tool:getCatalog");
    },
    execute: (toolName, args) => {
      return electron.ipcRenderer.invoke("tool:execute", toolName, args);
    }
  },
  // 证据链操作
  evidence: {
    getChain: () => {
      return electron.ipcRenderer.invoke("evidence:getChain");
    },
    getEvents: (eventType) => {
      return electron.ipcRenderer.invoke("evidence:getEvents", eventType);
    }
  },
  // LLM操作
  llm: {
    configure: (config) => {
      return electron.ipcRenderer.invoke("llm:configure", config);
    },
    testConnection: (provider) => {
      return electron.ipcRenderer.invoke("llm:testConnection", provider);
    },
    getAvailableModels: (provider) => {
      return electron.ipcRenderer.invoke("llm:getAvailableModels", provider);
    }
  },
  // 设置操作
  settings: {
    get: () => {
      return electron.ipcRenderer.invoke("settings:get");
    },
    set: (settings) => {
      return electron.ipcRenderer.invoke("settings:set", settings);
    }
  },
  windowControls: {
    minimize: () => {
      return electron.ipcRenderer.invoke("window:minimize");
    },
    toggleMaximize: () => {
      return electron.ipcRenderer.invoke("window:toggleMaximize");
    },
    close: () => {
      return electron.ipcRenderer.invoke("window:close");
    },
    isMaximized: () => {
      return electron.ipcRenderer.invoke("window:isMaximized");
    }
  },
  // 事件监听
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
