import type { ElectronAPI } from '../types/electron';
import type { LlmApi, MemoryApi, SettingsApi } from '../types/electron-api';
import type { RendererApiTransport } from './transport';

export function createMemoryApi(transport: RendererApiTransport): MemoryApi {
  return {
    issueApprovalToken: (request) => transport.invoke('memory:issueApprovalToken', request),
    list: (scope, projectRoot) => transport.invoke('memory:list', scope, projectRoot),
    get: (scope, name, projectRoot) => transport.invoke('memory:get', scope, name, projectRoot),
    write: (request) => transport.invoke('memory:write', request),
    delete: (scope, name, approvalToken, projectRoot) =>
      transport.invoke('memory:delete', scope, name, approvalToken, projectRoot),
  };
}

export function createRdcRuntimeApi(transport: RendererApiTransport): ElectronAPI['rdcRuntime'] {
  return {
    getOverview: (projectRoot) =>
      transport.invoke('rdc-runtime:overview', ...(projectRoot === undefined ? [] : [projectRoot])),
    validateResource: (request) => transport.invoke('rdc-runtime:validate', request),
    upsertResource: (request) => transport.invoke('rdc-runtime:upsert', request),
    importResource: (request) => transport.invoke('rdc-runtime:import', request),
    deleteResource: (kind, scope, id, projectRoot) =>
      transport.invoke('rdc-runtime:delete', kind, scope, id, ...(projectRoot === undefined ? [] : [projectRoot])),
    revealResource: (sourcePath) => transport.invoke('rdc-runtime:reveal', sourcePath),
    trustHook: (projectRoot, hookId) => transport.invoke('rdc-runtime:trustHook', projectRoot, hookId),
    revokeHook: (projectRoot, hookId) => transport.invoke('rdc-runtime:revokeHook', projectRoot, hookId),
    trustMcp: (projectRoot, descriptorId) => transport.invoke('rdc-runtime:trustMcp', projectRoot, descriptorId),
    revokeMcp: (projectRoot, descriptorId) => transport.invoke('rdc-runtime:revokeMcp', projectRoot, descriptorId),
    testHook: (event, projectRoot, hookId) => transport.invoke('rdc-runtime:testHook', event, projectRoot, hookId),
    listRequestSnapshots: (sessionId, turnId) => transport.invoke('rdc-runtime:listSnapshots', sessionId, turnId),
    getRequestSnapshot: (sessionId, turnId, snapshotId) =>
      transport.invoke('rdc-runtime:getSnapshot', sessionId, turnId, snapshotId),
  };
}

export function createLlmApi(transport: RendererApiTransport): LlmApi {
  return {
    testProviderDraft: (request) => transport.invoke('llm:testProviderDraft', request),
    prepareProbeBatch: (request) => transport.invoke('llm:prepareProbeBatch', request),
    startProbeBatch: (id) => transport.invoke('llm:startProbeBatch', id),
    cancelProbeBatch: (id) => transport.invoke('llm:cancelProbeBatch', id),
    getProbeBatch: () => transport.invoke('llm:getProbeBatch'),
    testModelCapability: (request) => transport.invoke('llm:testModelCapability', request),
    connectProvider: (request) => transport.invoke('llm:connectProvider', request),
    refreshProviderModels: (providerId, scope) =>
      scope
        ? transport.invoke('llm:refreshProviderModels', providerId, scope)
        : transport.invoke('llm:refreshProviderModels', providerId),
    disconnectProvider: (providerId) => transport.invoke('llm:disconnectProvider', providerId),
    startProviderAccountLogin: (request) => transport.invoke('llm:startProviderAccountLogin', request),
    getProviderAccountStatus: (providerId) => transport.invoke('llm:getProviderAccountStatus', providerId),
    finishProviderAccountLogin: (request) => transport.invoke('llm:finishProviderAccountLogin', request),
    cancelProviderAccountLogin: (providerId) => transport.invoke('llm:cancelProviderAccountLogin', providerId),
    logoutProviderAccount: (providerId) => transport.invoke('llm:logoutProviderAccount', providerId),
  };
}

export function createSettingsApi(transport: RendererApiTransport): SettingsApi {
  return {
    get: () => transport.invoke('settings:get'),
    getProviderCatalog: () => transport.invoke('settings:getProviderCatalog'),
    getEffectiveModel: (agentId) => transport.invoke('settings:getEffectiveModel', agentId),
    getEffectiveCatalog: (providerId, accountId) =>
      typeof accountId === 'string' && accountId.length > 0
        ? transport.invoke('settings:getEffectiveCatalog', providerId, accountId)
        : transport.invoke('settings:getEffectiveCatalog', providerId),
    hasProviderSecret: (providerId) => transport.invoke('settings:hasProviderSecret', providerId),
    importAgentManifest: (filePath) => transport.invoke('settings:importAgentManifest', filePath),
    saveAgentDefinition: (request) => transport.invoke('settings:saveAgentDefinition', request),
    getAgentDefinitionCommit: (query) => transport.invoke('settings:getAgentDefinitionCommit', query),
    previewAgentOverrideFile: (sourcePath) => transport.invoke('settings:previewAgentOverrideFile', sourcePath),
    deleteAgentOverrideFile: (request) => transport.invoke('settings:deleteAgentOverrideFile', request),
    previewProjectAgentTrust: (sourcePath) => transport.invoke('settings:previewProjectAgentTrust', sourcePath),
    trustProjectAgent: (request) => transport.invoke('settings:trustProjectAgent', request),
    getAgentBuiltinComparison: (query) => transport.invoke('settings:getAgentBuiltinComparison', query),
    saveProviderDefinition: (request) => transport.invoke('settings:saveProviderDefinition', request),
    getProviderDefinitionCommit: (providerId) => transport.invoke('settings:getProviderDefinitionCommit', providerId),
    getModelsOverride: () => transport.invoke('settings:getModelsOverride'),
    setModelsOverride: (overrides) => transport.invoke('settings:setModelsOverride', overrides),
    getResolvedShell: (executable) => transport.invoke('settings:getResolvedShell', executable),
    patch: (ops) => transport.invoke('settings:patch', ops),
  };
}
