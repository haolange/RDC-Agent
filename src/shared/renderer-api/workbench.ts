import type { ElectronAPI } from '../types/electron';
import type {
  CaptureApi,
  ContextApi,
  DeviceApi,
  ProjectApi,
  RunApi,
  RuntimeLogApi,
  SessionApi,
} from '../types/electron-api';
import { RENDERER_INVOKE_CHANNEL as INVOKE } from './channels';
import type { RendererApiTransport } from './transport';

export function createProjectApi(transport: RendererApiTransport): ProjectApi {
  return {
    list: () => transport.invoke(INVOKE.project.list),
    add: (rootPath) => transport.invoke(INVOKE.project.add, rootPath),
    select: (projectId) => transport.invoke(INVOKE.project.select, projectId),
    rename: (projectId, newName) => transport.invoke(INVOKE.project.rename, projectId, newName),
    remove: (projectId) => transport.invoke(INVOKE.project.remove, projectId),
    inputs: {
      list: (projectId) => transport.invoke(INVOKE.project.listInputs, projectId),
      refresh: (projectId) => transport.invoke(INVOKE.project.refreshInputs, projectId),
      import: (projectId) => transport.invoke(INVOKE.project.importInput, projectId),
      importPaths: (projectId, filePaths) => (
        transport.invoke(INVOKE.project.importInputPaths, projectId, filePaths)
      ),
    },
  };
}

export function createDeviceApi(transport: RendererApiTransport): DeviceApi {
  return {
    list: () => transport.invoke(INVOKE.device.list),
    refresh: () => transport.invoke(INVOKE.device.refresh),
    activate: (deviceId) => transport.invoke(INVOKE.device.activate, deviceId),
    watchStart: () => transport.invoke(INVOKE.device.watchStart),
    watchRenew: () => transport.invoke(INVOKE.device.watchRenew),
    watchStop: () => transport.invoke(INVOKE.device.watchStop),
  };
}

export function createSessionApi(transport: RendererApiTransport): SessionApi {
  return {
    list: (projectId) => transport.invoke(INVOKE.session.list, projectId),
    create: (projectId, title) => transport.invoke(INVOKE.session.create, projectId, title),
    rename: (id, title) => transport.invoke(INVOKE.session.rename, id, title),
    remove: (id) => transport.invoke(INVOKE.session.remove, id),
    select: (id) => transport.invoke(INVOKE.session.select, id),
    setModelOverride: (id, modelOverride) => (
      transport.invoke(INVOKE.session.setModelOverride, id, modelOverride)
    ),
    setAgentId: (id, agentId) => transport.invoke(INVOKE.session.setAgentId, id, agentId),
  };
}

export function createRunApi(transport: RendererApiTransport): RunApi {
  return { list: (sessionId) => transport.invoke(INVOKE.run.list, sessionId) };
}

export function createRuntimeLogApi(transport: RendererApiTransport): RuntimeLogApi {
  return { list: (request) => transport.invoke(INVOKE.runtime.listLogs, request) };
}

export function createCaptureApi(transport: RendererApiTransport): CaptureApi {
  return {
    list: (scope) => transport.invoke(INVOKE.capture.list, scope),
    select: (request) => transport.invoke(INVOKE.capture.select, request),
    openProjectInput: (request) => transport.invoke(INVOKE.capture.openProjectInput, request),
    getOpenedState: (scope) => transport.invoke(INVOKE.capture.getOpenedState, scope),
    clearOpenedState: (scope) => transport.invoke(INVOKE.capture.clearOpenedState, scope),
  };
}

export function createContextApi(transport: RendererApiTransport): ContextApi {
  return {
    get: (scope) => transport.invoke(INVOKE.context.get, scope),
    openHumanPreview: (scope) => transport.invoke(INVOKE.context.openHumanPreview, scope),
    closeHumanPreview: (scope) => transport.invoke(INVOKE.context.closeHumanPreview, scope),
  };
}

export function createTraceApi(transport: RendererApiTransport): ElectronAPI['trace'] {
  return {
    getRun: (runId) => transport.invoke(INVOKE.trace.getRun, runId),
    getEvents: (runId, afterSeq) => transport.invoke(INVOKE.trace.getEvents, runId, afterSeq),
    getProjection: (sessionId) => transport.invoke(INVOKE.trace.getProjection, sessionId),
    exportRun: (runId) => transport.invoke(INVOKE.trace.exportRun, runId),
    switchBranch: (sessionId, branchId) => transport.invoke(INVOKE.trace.switchBranch, sessionId, branchId),
  };
}
