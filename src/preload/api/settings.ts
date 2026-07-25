import { ipcRenderer } from 'electron';
import type { LlmApi, SettingsApi } from '@shared/types/electron-api';

export const createLlmApi = (): LlmApi => ({
  testProviderDraft: (request): ReturnType<LlmApi['testProviderDraft']> =>
    ipcRenderer.invoke('llm:testProviderDraft', request),
  testModelCapability: (request): ReturnType<LlmApi['testModelCapability']> =>
    ipcRenderer.invoke('llm:testModelCapability', request),
  connectProvider: (request): ReturnType<LlmApi['connectProvider']> =>
    ipcRenderer.invoke('llm:connectProvider', request),
  refreshProviderModels: (providerId): ReturnType<LlmApi['refreshProviderModels']> =>
    ipcRenderer.invoke('llm:refreshProviderModels', providerId),
  disconnectProvider: (providerId): ReturnType<LlmApi['disconnectProvider']> =>
    ipcRenderer.invoke('llm:disconnectProvider', providerId),
  startProviderAccountLogin: (request): ReturnType<LlmApi['startProviderAccountLogin']> =>
    ipcRenderer.invoke('llm:startProviderAccountLogin', request),
  getProviderAccountStatus: (providerId): ReturnType<LlmApi['getProviderAccountStatus']> =>
    ipcRenderer.invoke('llm:getProviderAccountStatus', providerId),
  finishProviderAccountLogin: (request): ReturnType<LlmApi['finishProviderAccountLogin']> =>
    ipcRenderer.invoke('llm:finishProviderAccountLogin', request),
  logoutProviderAccount: (providerId): ReturnType<LlmApi['logoutProviderAccount']> =>
    ipcRenderer.invoke('llm:logoutProviderAccount', providerId),
});

export const createSettingsApi = (): SettingsApi => ({
  get: (): ReturnType<SettingsApi['get']> => ipcRenderer.invoke('settings:get'),
  getProviderCatalog: (): ReturnType<SettingsApi['getProviderCatalog']> =>
    ipcRenderer.invoke('settings:getProviderCatalog'),
  getEffectiveModel: (agentId): ReturnType<SettingsApi['getEffectiveModel']> =>
    ipcRenderer.invoke('settings:getEffectiveModel', agentId),
  getEffectiveCatalog: (providerId, accountId): ReturnType<SettingsApi['getEffectiveCatalog']> =>
    ipcRenderer.invoke('settings:getEffectiveCatalog', providerId, accountId),
  hasProviderSecret: (providerId): ReturnType<SettingsApi['hasProviderSecret']> =>
    ipcRenderer.invoke('settings:hasProviderSecret', providerId),
  importAgentManifest: (filePath): ReturnType<SettingsApi['importAgentManifest']> =>
    ipcRenderer.invoke('settings:importAgentManifest', filePath),
  saveAgentDefinition: (request): ReturnType<SettingsApi['saveAgentDefinition']> =>
    ipcRenderer.invoke('settings:saveAgentDefinition', request),
  getAgentDefinitionCommit: (agentId): ReturnType<SettingsApi['getAgentDefinitionCommit']> =>
    ipcRenderer.invoke('settings:getAgentDefinitionCommit', agentId),
  saveProviderDefinition: (request): ReturnType<SettingsApi['saveProviderDefinition']> =>
    ipcRenderer.invoke('settings:saveProviderDefinition', request),
  getProviderDefinitionCommit: (providerId): ReturnType<SettingsApi['getProviderDefinitionCommit']> =>
    ipcRenderer.invoke('settings:getProviderDefinitionCommit', providerId),
  set: (settings): ReturnType<SettingsApi['set']> => ipcRenderer.invoke('settings:set', settings),
});
