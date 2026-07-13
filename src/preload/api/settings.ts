import { ipcRenderer } from 'electron';
import type { LlmApi, SettingsApi } from '@shared/types/electron-api';

export const createLlmApi = (): LlmApi => ({
  configure: (config): ReturnType<LlmApi['configure']> => ipcRenderer.invoke('llm:configure', config),
  testConnection: (provider): ReturnType<LlmApi['testConnection']> =>
    ipcRenderer.invoke('llm:testConnection', provider),
  getAvailableModels: (provider): ReturnType<LlmApi['getAvailableModels']> =>
    ipcRenderer.invoke('llm:getAvailableModels', provider),
  testProviderDraft: (request): ReturnType<LlmApi['testProviderDraft']> =>
    ipcRenderer.invoke('llm:testProviderDraft', request),
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
  getEffectiveCatalog: (providerId): ReturnType<SettingsApi['getEffectiveCatalog']> =>
    ipcRenderer.invoke('settings:getEffectiveCatalog', providerId),
  getProviderSecret: (providerId): ReturnType<SettingsApi['getProviderSecret']> =>
    ipcRenderer.invoke('settings:getProviderSecret', providerId),
  importAgentManifest: (filePath): ReturnType<SettingsApi['importAgentManifest']> =>
    ipcRenderer.invoke('settings:importAgentManifest', filePath),
  set: (settings): ReturnType<SettingsApi['set']> => ipcRenderer.invoke('settings:set', settings),
});
