/**
 * Electron Preload Script
 */

import { contextBridge } from 'electron';
import type { ElectronAPI } from '@shared/types/electron';
import { isPreloadEventChannel } from './api/channels';
import { createAgentApi } from './api/agent';
import { createCaptureApi, createContextApi, createDeviceApi } from './api/captureContext';
import { createConversationApi } from './api/conversation';
import { createCommandApi } from './api/command';
import { createEventSubscriptionApi } from './api/events';
import { createMemoryApi } from './api/memory';
import { registerTrackedListener, removeTrackedListener } from './api/listeners';
import { createProjectApi, createRunApi, createSessionApi } from './api/projectSession';
import { createRuntimeLogApi, createTerminalApi } from './api/runtime';
import { createLlmApi, createSettingsApi } from './api/settings';
import { createAppMetaApi, createAppShellApi, createDialogApi, createWindowControlsApi } from './api/shell';
import { createEvidenceApi, createMcpApi, createToolApi } from './api/toolEvidence';
import { createWorkflowApi } from './api/workflow';
import { createTraceApi } from './api/trace';
import { createRdxRuntimeApi } from './api/rdxRuntime';

const dialogApi = createDialogApi();

const electronAPI = {
  platform: process.platform,
  isMac: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',

  appMeta: createAppMetaApi(),
  appShell: createAppShellApi(),
  conversation: createConversationApi(),
  command: createCommandApi(),

  selectFiles: dialogApi.selectFiles,
  selectRdcFiles: dialogApi.selectRdcFiles,
  selectDirectory: dialogApi.selectDirectory,

  workflow: createWorkflowApi(),
  trace: createTraceApi(),
  agent: createAgentApi(),
  memory: createMemoryApi(),
  rdxRuntime: createRdxRuntimeApi(),
  tool: createToolApi(),
  mcp: createMcpApi(),
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

  on: (channel: string, callback: (...args: unknown[]) => void): void => {
    if (isPreloadEventChannel(channel)) {
      registerTrackedListener(channel, callback);
    }
  },

  off: (channel: string, callback: (...args: unknown[]) => void): void => {
    removeTrackedListener(channel, callback);
  },
} as ElectronAPI;

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
