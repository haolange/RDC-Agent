"use strict";
const electron = require("electron");
const electronAPI = {
  // 平台信息
  platform: process.platform,
  isMac: process.platform === "darwin",
  isWindows: process.platform === "win32",
  isLinux: process.platform === "linux",
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
  // 事件监听
  on: (channel, callback) => {
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
      "llm:stream"
    ];
    if (validChannels.includes(channel)) {
      electron.ipcRenderer.on(channel, (_event, ...args) => callback(...args));
    }
  },
  off: (channel, callback) => {
    electron.ipcRenderer.removeListener(channel, callback);
  }
};
electron.contextBridge.exposeInMainWorld("electronAPI", electronAPI);
