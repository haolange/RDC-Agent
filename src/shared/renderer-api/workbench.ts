import type { ElectronAPI } from '../types/electron';
import type { CaptureApi, ContextApi, DeviceApi, ProjectApi, RuntimeLogApi, SessionApi } from '../types/electron-api';
import type { RendererApiTransport } from './transport';

export function createProjectApi(transport: RendererApiTransport): ProjectApi {
  return {
    list: () => transport.invoke('project:list'),
    add: (rootPath) => transport.invoke('project:add', rootPath),
    select: (projectId) => transport.invoke('project:select', projectId),
    rename: (projectId, newName) => transport.invoke('project:rename', projectId, newName),
    remove: (projectId) => transport.invoke('project:remove', projectId),
    inputs: {
      list: (projectId) => transport.invoke('project:inputs:list', projectId),
      refresh: (projectId) => transport.invoke('project:inputs:refresh', projectId),
      prepareRemove: (projectId, inputId) => transport.invoke('project:inputs:prepareRemove', projectId, inputId),
      remove: (projectId, inputId, approvalToken) =>
        transport.invoke('project:inputs:remove', projectId, inputId, approvalToken),
      import: (projectId) => transport.invoke('project:inputs:import', projectId),
      referencePath: (projectId, filePath) => transport.invoke('project:inputs:reference', projectId, filePath),
      importPaths: (projectId, filePaths) => transport.invoke('project:inputs:importPaths', projectId, filePaths),
    },
  };
}

export function createDeviceApi(transport: RendererApiTransport): DeviceApi {
  return {
    prepare: (request) => transport.invoke('device:prepare', request),
    cancelPreparation: (request) => transport.invoke('device:cancelPreparation', request),
    list: () => transport.invoke('device:list'),
    refresh: () => transport.invoke('device:refresh'),
    watchStart: () => transport.invoke('device:watch:start'),
    watchRenew: () => transport.invoke('device:watch:renew'),
    watchStop: () => transport.invoke('device:watch:stop'),
  };
}

export function createSessionApi(transport: RendererApiTransport): SessionApi {
  return {
    list: (projectId) => transport.invoke('session:list', projectId),
    create: (projectId, title) => transport.invoke('session:create', projectId, title),
    rename: (id, title) => transport.invoke('session:rename', id, title),
    remove: (id) => transport.invoke('session:remove', id),
    open: (id) => transport.invoke('session:open', id),
    setModelOverride: (id, request) => transport.invoke('session:setModelOverride', id, request),
    setAgentId: (id, agentId) => transport.invoke('session:setAgentId', id, agentId),
    applyDeclaredHandoff: (id, agent, label, expectedPlanHash) =>
      expectedPlanHash
        ? transport.invoke('session:applyDeclaredHandoff', id, agent, label, expectedPlanHash)
        : transport.invoke('session:applyDeclaredHandoff', id, agent, label),
  };
}

export function createRuntimeLogApi(transport: RendererApiTransport): RuntimeLogApi {
  return { list: (request) => transport.invoke('runtimeLog:list', request) };
}

export function createCaptureApi(transport: RendererApiTransport): CaptureApi {
  return {
    getReplaySelection: (scope) => transport.invoke('capture:getReplaySelection', scope),
    readLivePreview: (scope) => transport.invoke('capture:readLivePreview', scope),
    getReplayState: (scope) => transport.invoke('capture:getReplayState', scope),
    getRecovery: (scope) => transport.invoke('capture:getRecovery', scope),
    restorePrevious: (scope) => transport.invoke('capture:restorePrevious', scope),
    applyReplayEvent: (request) => transport.invoke('capture:applyReplayEvent', request),
    refreshFrame: (scope) => transport.invoke('capture:refreshFrame', scope),
    list: (scope) => transport.invoke('capture:list', scope),
    select: (request) => transport.invoke('capture:select', request),
    openProjectInput: (request) => transport.invoke('capture:openProjectInput', request),
    getOpenedState: (scope) => transport.invoke('capture:getOpenedState', scope),
    clearOpenedState: (scope) => transport.invoke('capture:clearOpenedState', scope),
  };
}

export function createContextApi(transport: RendererApiTransport): ContextApi {
  return {
    get: (scope) => transport.invoke('context:get', scope),
  };
}

export function createTraceApi(transport: RendererApiTransport): ElectronAPI['trace'] {
  return {
    getProjection: (sessionId) => transport.invoke('trace:getProjection', sessionId),
  };
}
