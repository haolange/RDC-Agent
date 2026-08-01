import type { ElectronAPI } from '../types/electron';
import type { LlmApi, MemoryApi, SettingsApi } from '../types/electron-api';
import { RENDERER_INVOKE_CHANNEL as INVOKE } from './channels';
import type { RendererApiTransport } from './transport';

export function createMemoryApi(transport: RendererApiTransport): MemoryApi {
  return {
    issueApprovalToken: (request) => transport.invoke(INVOKE.memory.issueApprovalToken, request),
    list: (scope, projectRoot) => transport.invoke(INVOKE.memory.list, scope, projectRoot),
    get: (scope, name, projectRoot) => transport.invoke(INVOKE.memory.get, scope, name, projectRoot),
    write: (request) => transport.invoke(INVOKE.memory.write, request),
    delete: (scope, name, approvalToken, projectRoot) => (
      transport.invoke(INVOKE.memory.delete, scope, name, approvalToken, projectRoot)
    ),
  };
}

export function createRdxRuntimeApi(transport: RendererApiTransport): ElectronAPI['rdxRuntime'] {
  return {
    getOverview: (projectRoot) => transport.invoke(INVOKE.rdxRuntime.getOverview, projectRoot),
    validateResource: (request) => transport.invoke(INVOKE.rdxRuntime.validateResource, request),
    upsertResource: (request) => transport.invoke(INVOKE.rdxRuntime.upsertResource, request),
    importResource: (request) => transport.invoke(INVOKE.rdxRuntime.importResource, request),
    deleteResource: (kind, scope, id, projectRoot) => (
      transport.invoke(INVOKE.rdxRuntime.deleteResource, kind, scope, id, projectRoot)
    ),
    revealResource: (sourcePath) => transport.invoke(INVOKE.rdxRuntime.revealResource, sourcePath),
    trustHook: (projectRoot, hookId) => transport.invoke(INVOKE.rdxRuntime.trustHook, projectRoot, hookId),
    revokeHook: (projectRoot, hookId) => transport.invoke(INVOKE.rdxRuntime.revokeHook, projectRoot, hookId),
    trustMcp: (projectRoot, descriptorId) => (
      transport.invoke(INVOKE.rdxRuntime.trustMcp, projectRoot, descriptorId)
    ),
    revokeMcp: (projectRoot, descriptorId) => (
      transport.invoke(INVOKE.rdxRuntime.revokeMcp, projectRoot, descriptorId)
    ),
    testHook: (event, projectRoot, hookId) => (
      transport.invoke(INVOKE.rdxRuntime.testHook, event, projectRoot, hookId)
    ),
    listRequestSnapshots: (sessionId, turnId) => (
      transport.invoke(INVOKE.rdxRuntime.listRequestSnapshots, sessionId, turnId)
    ),
    getRequestSnapshot: (sessionId, turnId, snapshotId) => (
      transport.invoke(INVOKE.rdxRuntime.getRequestSnapshot, sessionId, turnId, snapshotId)
    ),
  };
}

export function createLlmApi(transport: RendererApiTransport): LlmApi {
  return {
    testProviderDraft: (request) => transport.invoke(INVOKE.llm.testProviderDraft, request),
    testModelCapability: (request) => transport.invoke(INVOKE.llm.testModelCapability, request),
    connectProvider: (request) => transport.invoke(INVOKE.llm.connectProvider, request),
    refreshProviderModels: (providerId) => transport.invoke(INVOKE.llm.refreshProviderModels, providerId),
    disconnectProvider: (providerId) => transport.invoke(INVOKE.llm.disconnectProvider, providerId),
    startProviderAccountLogin: (request) => transport.invoke(INVOKE.llm.startProviderAccountLogin, request),
    getProviderAccountStatus: (providerId) => transport.invoke(INVOKE.llm.getProviderAccountStatus, providerId),
    finishProviderAccountLogin: (request) => transport.invoke(INVOKE.llm.finishProviderAccountLogin, request),
    logoutProviderAccount: (providerId) => transport.invoke(INVOKE.llm.logoutProviderAccount, providerId),
  };
}

export function createSettingsApi(transport: RendererApiTransport): SettingsApi {
  return {
    get: () => transport.invoke(INVOKE.settings.get),
    getProviderCatalog: () => transport.invoke(INVOKE.settings.getProviderCatalog),
    getEffectiveModel: (agentId) => transport.invoke(INVOKE.settings.getEffectiveModel, agentId),
    getEffectiveCatalog: (providerId, accountId) => (
      typeof accountId === 'string' && accountId.length > 0
        ? transport.invoke(INVOKE.settings.getEffectiveCatalog, providerId, accountId)
        : transport.invoke(INVOKE.settings.getEffectiveCatalog, providerId)
    ),
    hasProviderSecret: (providerId) => transport.invoke(INVOKE.settings.hasProviderSecret, providerId),
    importAgentManifest: (filePath) => transport.invoke(INVOKE.settings.importAgentManifest, filePath),
    saveAgentDefinition: (request) => transport.invoke(INVOKE.settings.saveAgentDefinition, request),
    getAgentDefinitionCommit: (agentId) => transport.invoke(INVOKE.settings.getAgentDefinitionCommit, agentId),
    saveProviderDefinition: (request) => transport.invoke(INVOKE.settings.saveProviderDefinition, request),
    getProviderDefinitionCommit: (providerId) => (
      transport.invoke(INVOKE.settings.getProviderDefinitionCommit, providerId)
    ),
    getModelsOverride: () => transport.invoke(INVOKE.settings.getModelsOverride),
    setModelsOverride: (overrides) => transport.invoke(INVOKE.settings.setModelsOverride, overrides),
    set: (settings) => transport.invoke(INVOKE.settings.set, settings),
  };
}
