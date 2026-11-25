import { IPC_ERROR_KEY, isIpcErrorResult, RendererIpcError } from '../errors/appError';
import { isRendererEventChannel, type RendererInvokeChannel } from './channels';
import {
  createAppMetaApi,
  createAppShellApi,
  createCommandApi,
  createConversationApi,
  createDialogApi,
  createEvidenceApi,
  createInvestigationApi,
  createKnowledgeApi,
  createPlanApi,
  createMcpApi,
  createToolApi,
  createWebApi,
  createWindowControlsApi,
  createWorkflowApi,
} from './core';
import { createEventSubscriptionApi } from './events';
import { createLlmApi, createMemoryApi, createRdcRuntimeApi, createSettingsApi } from './settings';
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
import type { RendererApiTransport } from './transport';
import type { ElectronAPI } from '../types/electron';

/** Every invoke resolves with its value; a failed call throws `RendererIpcError` carrying the code and params. */
function failingOnErrorResults(transport: RendererApiTransport): RendererApiTransport {
  return {
    invoke: async <TResult>(channel: RendererInvokeChannel, ...args: unknown[]): Promise<TResult> => {
      const result = await transport.invoke<TResult>(channel, ...args);
      if (isIpcErrorResult(result)) throw new RendererIpcError(channel, result[IPC_ERROR_KEY]);
      return result;
    },
    subscribe: (channel, callback) => transport.subscribe(channel, callback),
    addListener: (channel, callback) => transport.addListener(channel, callback),
    removeListener: (channel, callback) => transport.removeListener(channel, callback),
    removeAllListeners: (channel) => transport.removeAllListeners(channel),
  };
}

export function createRendererApi(platform: NodeJS.Platform, ipcTransport: RendererApiTransport): ElectronAPI {
  const transport = failingOnErrorResults(ipcTransport);
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
    selectKnowledgeImport: dialog.selectKnowledgeImport,
    selectDirectory: dialog.selectDirectory,
    workflow: createWorkflowApi(transport),
    trace: createTraceApi(transport),
    memory: createMemoryApi(transport),
    investigation: createInvestigationApi(transport),
    plan: createPlanApi(transport),
    knowledge: createKnowledgeApi(transport),
    rdcRuntime: createRdcRuntimeApi(transport),
    tool: createToolApi(transport),
    mcp: createMcpApi(transport),
    evidence: createEvidenceApi(transport),
    llm: createLlmApi(transport),
    settings: createSettingsApi(transport),
    project: createProjectApi(transport),
    device: createDeviceApi(transport),
    session: createSessionApi(transport),
    run: createRunApi(transport),
    runtime: { getPermissionState: () => transport.invoke('runtime:getPermissionState') },
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
