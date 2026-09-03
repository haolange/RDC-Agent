import type { ElectronAPI } from '../types/electron';
import { isRendererEventChannel } from './channels';
import {
  createAgentApi,
  createAppMetaApi,
  createAppShellApi,
  createCommandApi,
  createConversationApi,
  createDialogApi,
  createEvidenceApi,
  createInvestigationApi,
  createKnowledgeApi,
  createMcpApi,
  createToolApi,
  createWebApi,
  createWindowControlsApi,
  createWorkflowApi,
} from './core';
import { createEventSubscriptionApi } from './events';
import { createLlmApi, createMemoryApi, createRdxRuntimeApi, createSettingsApi } from './settings';
import type { RendererApiTransport } from './transport';
import {
  createCaptureApi,
  createContextApi,
  createDeviceApi,
  createProjectApi,
  createRunApi,
  createRuntimeLogApi,
  createSessionApi,
  createTraceApi,
} from './workbench';

export function createRendererApi(platform: NodeJS.Platform, transport: RendererApiTransport): ElectronAPI {
  const dialog = createDialogApi(transport);
  return {
    platform,
    isMac: platform === 'darwin',
    isWindows: platform === 'win32',
    isLinux: platform === 'linux',
    appMeta: createAppMetaApi(transport),
    appShell: createAppShellApi(transport),
    web: createWebApi(transport),
    conversation: createConversationApi(transport),
    command: createCommandApi(transport),
    selectFiles: dialog.selectFiles,
    selectRdcFiles: dialog.selectRdcFiles,
    selectDirectory: dialog.selectDirectory,
    workflow: createWorkflowApi(transport),
    trace: createTraceApi(transport),
    agent: createAgentApi(transport),
    memory: createMemoryApi(transport),
    investigation: createInvestigationApi(transport),
    knowledge: createKnowledgeApi(transport),
    rdxRuntime: createRdxRuntimeApi(transport),
    tool: createToolApi(transport),
    mcp: createMcpApi(transport),
    evidence: createEvidenceApi(transport),
    llm: createLlmApi(transport),
    settings: createSettingsApi(transport),
    project: createProjectApi(transport),
    device: createDeviceApi(transport),
    session: createSessionApi(transport),
    run: createRunApi(transport),
    runtimeLog: createRuntimeLogApi(transport),
    capture: createCaptureApi(transport),
    context: createContextApi(transport),
    events: createEventSubscriptionApi(transport),
    windowControls: createWindowControlsApi(transport),
    on: (channel, callback) => {
      if (isRendererEventChannel(channel)) transport.addListener(channel, callback);
    },
    off: (channel, callback) => {
      if (isRendererEventChannel(channel)) transport.removeListener(channel, callback);
    },
  };
}
